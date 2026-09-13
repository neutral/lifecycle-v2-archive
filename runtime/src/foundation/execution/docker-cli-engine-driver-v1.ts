import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { spawn } from "node:child_process";
import { FoundationError } from "../error.js";
import {
  canonicalJson,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import type {
  FoundationExecutionOutputEntryReaderV1,
  FoundationRetrievedExecutionOutputV1,
} from "./backend.js";
import type {
  FoundationExecutionBackendProfileV1,
  FoundationExecutionOutputManifestV1,
  FoundationExecutionSpecificationV1,
} from "./contracts.js";
import type { FoundationExecutionInputSetV1 } from "./input-set.js";
import { assertFoundationDockerCellInspectionV1 } from "./docker-backend.js";
import type {
  FoundationDockerCellCreateRequestV1,
  FoundationDockerCellDirectObservationV1,
  FoundationDockerCellDiscoveryV1,
  FoundationDockerCellIdentityDiscoveryV1,
  FoundationDockerCellInspectionV1,
  FoundationDockerEngineDescriptionV1,
  FoundationDockerEngineDriverV1,
  FoundationDockerImageObservationV1,
  FoundationDockerOutputRetrievalV1,
} from "./docker-backend.js";

const DRIVER_SCHEMA = "lifecycle.docker-cli-engine-driver.private.v1";
const RUNNER_CONTRACT_ID = "lifecycle.execution-cell-runner.v1" as const;
const RUNNER_ENTRYPOINT = "/opt/lifecycle/bin/execution-cell-runner";
const INPUT_ROOT = "/lifecycle/input";
const OUTPUT_ROOT = "/lifecycle/output";
// A distinct volume remains durable despite its position beneath Cell tmpfs.
const PROVIDER_STATE_ROOT = "/tmp/lifecycle-provider-state";
const PROVIDER_CREDENTIAL_FRAME_MAGIC = Buffer.from("LCPCRV1\0", "binary");
const SPECIFICATION_PATH = ".lifecycle/specification.json";
const INPUT_SET_PATH = ".lifecycle/input-set.json";
const OUTPUT_MANIFEST_PATH = ".lifecycle/output-manifest.json";
const OUTPUT_MANIFEST_SCHEMA_ID = "urn:lifecycle:schema:execution-output-manifest:v1";
const PUBLIC_CELL_LABEL_PREFIX = "io.lifecycle.execution-cell.v1.";
const PRIVATE_LABEL_PREFIX = "io.lifecycle.execution-driver.v1.";
const IMAGE_LABEL_PREFIX = "io.lifecycle.execution-image.v1.";
const MAXIMUM_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAXIMUM_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const MAXIMUM_CONFIGURATION_LABEL_BYTES = 256 * 1024;
const MAXIMUM_INPUT_ENTRIES = 16_384;
const TAR_BLOCK_BYTES = 512;
const MAXIMUM_PAX_HEADER_BYTES = 8192;
const MAXIMUM_PROVIDER_AUTH_BYTES = 4 * 1024 * 1024;
const PROVIDER_SUPPORT_SCHEMA = "lifecycle.agent-provider-support.private.v1";
const PROVIDER_SUPPORT_FRAME_MAGIC = Buffer.from("LCPSV1!\0", "binary");
const PROVIDER_CONTROL_ALIAS = "provider-control";
const PROVIDER_CONTROL_PORT = 18_080;

const PRIVATE_LABELS = Object.freeze({
  schema: `${PRIVATE_LABEL_PREFIX}schema`,
  configuration: `${PRIVATE_LABEL_PREFIX}configuration`,
  configurationDigest: `${PRIVATE_LABEL_PREFIX}configuration-digest`,
  inputVolume: `${PRIVATE_LABEL_PREFIX}input-volume`,
  outputVolume: `${PRIVATE_LABEL_PREFIX}output-volume`,
  providerStateVolume: `${PRIVATE_LABEL_PREFIX}provider-state-volume`,
  imageId: `${PRIVATE_LABEL_PREFIX}image-id`,
  imageDigest: `${PRIVATE_LABEL_PREFIX}image-digest`,
  specificationDigest: `${PRIVATE_LABEL_PREFIX}specification-digest`,
  resourceKind: `${PRIVATE_LABEL_PREFIX}resource-kind`,
  allocationName: `${PRIVATE_LABEL_PREFIX}allocation-name`,
  cellId: `${PRIVATE_LABEL_PREFIX}cell-id`,
  reclamationInspection: `${PRIVATE_LABEL_PREFIX}reclamation-inspection`,
  reclamationInspectionDigest: `${PRIVATE_LABEL_PREFIX}reclamation-inspection-digest`,
  providerSupport: `${PRIVATE_LABEL_PREFIX}provider-support`,
  providerSupportDigest: `${PRIVATE_LABEL_PREFIX}provider-support-digest`,
  providerNetwork: `${PRIVATE_LABEL_PREFIX}provider-network`,
  providerProxy: `${PRIVATE_LABEL_PREFIX}provider-proxy`,
});

type DockerArchitecture = "amd64" | "arm64";

export type FoundationDockerCliImageInstallationV1 = Readonly<{
  imageId: string;
  imageDigest: Sha256;
  immutableReference: string;
  configurationDigest: Sha256;
  platform: Readonly<{
    os: "linux";
    architecture: DockerArchitecture;
    variant: string | null;
  }>;
  nonRootUser: string;
  runnerContractId: typeof RUNNER_CONTRACT_ID;
  runnerContractDigest: Sha256;
  runnerImplementationDigest: Sha256;
  toolInventoryDigest: Sha256;
  agentProvider?: Readonly<{
    codexVersion: string;
    executableIdentity: Sha256;
    adapterImplementationDigest: Sha256;
  }>;
}>;

export type FoundationDockerAgentCredentialReaderV1 = Readonly<{
  byteLength: number;
  read(): AsyncIterable<Uint8Array>;
}>;

export type FoundationDockerProviderCredentialSubjectV1 = Readonly<{
  specificationDigest: Sha256;
  engineIdentityDigest: Sha256;
  allocationName: string;
}>;
export type FoundationDockerProviderCredentialSelectionV1 = Readonly<{
  subject: FoundationDockerProviderCredentialSubjectV1;
  credentialBinding: Readonly<{ id: string; policyDigest: Sha256 }>;
}>;
export type FoundationDockerProviderCredentialOutcomeV1 =
  | Readonly<{ kind: "updated"; bytes: Uint8Array }>
  | Readonly<{ kind: "unused" }>
  | Readonly<{ kind: "lost" }>;

/** Installation-private provider support, claimed for one exact allocation. */
export interface FoundationDockerAgentProviderSupportResolverV1 {
  readonly installation: Readonly<{
    providerDescriptorDigest: Sha256;
    adapterImplementationDigest: Sha256;
    executableIdentity: Sha256;
    codexVersion: string;
    model: string;
    reasoning: string;
  }>;
  claimCredential(input: FoundationDockerProviderCredentialSelectionV1): Promise<void>;
  hasCredentialClaim(input: FoundationDockerProviderCredentialSelectionV1): Promise<boolean>;
  openCredential(input: FoundationDockerProviderCredentialSelectionV1): Promise<FoundationDockerAgentCredentialReaderV1>;
  credentialSettlement(input: FoundationDockerProviderCredentialSelectionV1): Promise<boolean>;
  settleCredential(input: FoundationDockerProviderCredentialSelectionV1 & Readonly<{
    outcome: FoundationDockerProviderCredentialOutcomeV1;
  }>): Promise<void>;
  forgetCredentialSettlement(input: FoundationDockerProviderCredentialSelectionV1): Promise<void>;
}

export type FoundationDockerInputEntryReaderV1 = Readonly<{
  path: string;
  byteLength: number;
  digest: Sha256;
  modeClass: "regular" | "executable";
  read(): AsyncIterable<Uint8Array>;
}>;

export type FoundationDockerInputSetTransportV1 = Readonly<{
  inputSet: FoundationExecutionInputSetV1;
  inputSetDigest: Sha256;
  entries(): AsyncIterable<FoundationDockerInputEntryReaderV1>;
}>;

/**
 * Private bridge from the logical Input Set owner to bounded backend transport.
 * It exposes neither a target path nor a Cell coordinate. The fixed runner
 * remains responsible for validating the materialized Input Set digest.
 */
export interface FoundationDockerInputSetTransportResolverV1 {
  open(specification: FoundationExecutionSpecificationV1): Promise<FoundationDockerInputSetTransportV1>;
}

/** Durable installation-private sequence allocation; Activity checkpoints own no backend counter. */
export interface FoundationDockerObservationSequenceV1 {
  next(cellId: string): Promise<number>;
}

type CommandRequest = Readonly<{
  executable: string;
  arguments: readonly string[];
  environment: Readonly<Record<string, string>>;
  stdin: Uint8Array | null;
  timeoutMilliseconds: number;
  maximumStdoutBytes: number;
  maximumStderrBytes: number;
}>;

type CommandResult = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: Uint8Array;
  stderrTruncated: boolean;
}>;

/** Test injection is exported only from this private runtime module. */
export interface FoundationDockerCliCommandExecutorV1 {
  execute(request: CommandRequest): Promise<CommandResult>;
}

export type FoundationDockerCliEngineDriverOptionsV1 = Readonly<{
  profile: FoundationExecutionBackendProfileV1;
  dockerExecutable: string;
  dockerExecutableDigest: Sha256;
  engineEndpoint: string;
  dockerConfigDirectory: string;
  images: readonly FoundationDockerCliImageInstallationV1[];
  inputTransport: FoundationDockerInputSetTransportResolverV1;
  agentProviderSupport?: FoundationDockerAgentProviderSupportResolverV1;
  observationSequence: FoundationDockerObservationSequenceV1;
  now?: () => string;
}>;

type InternalOptions = FoundationDockerCliEngineDriverOptionsV1 & Readonly<{
  commandExecutor: FoundationDockerCliCommandExecutorV1;
  verifyExecutable: boolean;
}>;

type JsonRecord = Record<string, unknown>;

type ArchiveEntry = Readonly<{
  path: string;
  bytes: Uint8Array;
  modeClass: "regular" | "executable";
  portableMode?: number;
}>;

type AgentProviderSupport = Readonly<{
  schema: typeof PROVIDER_SUPPORT_SCHEMA;
  specificationDigest: Sha256;
  attemptDigest: Sha256;
  providerDescriptorDigest: Sha256;
  adapterImplementationDigest: Sha256;
  executableIdentity: Sha256;
  codexVersion: string;
  model: string;
  reasoning: string;
  credentialBinding: Readonly<{ id: string; policyDigest: Sha256 }>;
  digest: Sha256;
}>;

type CellMetadata = Readonly<{
  configuration: FoundationDockerCellCreateRequestV1["configuration"];
  publicLabels: Readonly<Record<string, string>>;
  inputVolume: string;
  outputVolume: string;
  providerStateVolume: string | null;
  image: FoundationDockerCliImageInstallationV1;
  providerSupport: AgentProviderSupport | null;
  providerNetwork: string | null;
  providerProxy: string | null;
  allocationName: string;
}>;

function fail(code: string, message: string, retryable = false): never {
  throw new FoundationError(`lifecycle.execution.docker-cli-driver.${code}`, message, {
    retryable,
  });
}

function isSha256(value: unknown): value is Sha256 {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) fail("response", `${label} is unavailable from the selected Docker Engine`, true);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.includes("\0") || Buffer.byteLength(value, "utf8") > 4096) {
    fail("response", `${label} is invalid in the selected Docker Engine response`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail("response", `${label} is invalid in the selected Docker Engine response`);
  }
  return value as number;
}

function json(bytes: Uint8Array, label: string): unknown {
  if (bytes.byteLength === 0) fail("response", `${label} is absent from the selected Docker Engine`, true);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail("response", `${label} is not one bounded JSON response from the selected Docker Engine`);
  }
}

function exactIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail("response", "Docker terminal time is invalid");
  return parsed.toISOString();
}

function safeName(value: string, label: string): string {
  if (!/^[a-z0-9][a-z0-9_.-]{0,126}$/u.test(value)) {
    fail("configuration", `${label} is outside the fixed Docker name domain`);
  }
  return value;
}

function safeLabel(value: string, label: string): string {
  if (Buffer.byteLength(value, "utf8") > MAXIMUM_CONFIGURATION_LABEL_BYTES || value.includes("\0")) {
    fail("configuration", `${label} exceeds its private Docker label bound`);
  }
  return value;
}

function safePath(path: string, label: string): string {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") ||
      path.includes("\0") || path.includes("//") || Buffer.byteLength(path, "utf8") > 4096 ||
      path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail("transport", `${label} contains an invalid logical path`);
  }
  return path;
}

function parseArchitecture(value: unknown): DockerArchitecture {
  if (value === "amd64" || value === "x86_64") return "amd64";
  if (value === "arm64" || value === "aarch64") return "arm64";
  fail("engine-platform", "Docker Engine architecture is unsupported");
}

function apiVersionAtLeast(observed: string, required: string): boolean {
  const parse = (value: string): readonly [number, number] | null => {
    const match = /^(\d+)\.(\d+)$/u.exec(value);
    if (match === null) return null;
    return [Number(match[1]), Number(match[2])];
  };
  const left = parse(observed);
  const right = parse(required);
  return left !== null && right !== null &&
    (left[0] > right[0] || (left[0] === right[0] && left[1] >= right[1]));
}

function dockerEnvironment(options: FoundationDockerCliEngineDriverOptionsV1): Readonly<Record<string, string>> {
  return Object.freeze({
    DOCKER_API_VERSION: options.profile.engineContract.compatibleVersion,
    DOCKER_CONFIG: options.dockerConfigDirectory,
    HOME: "/nonexistent",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/usr/bin:/bin",
    TZ: "UTC",
  });
}

class SpawnDockerCliCommandExecutor implements FoundationDockerCliCommandExecutorV1 {
  async execute(request: CommandRequest): Promise<CommandResult> {
    return await new Promise<CommandResult>((resolveResult, rejectResult) => {
      let child;
      try {
        child = spawn(request.executable, [...request.arguments], {
          cwd: "/",
          env: { ...request.environment },
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch {
        fail("command-unavailable", "The exact configured Docker executable could not start", true);
      }
      const stdout: Buffer[] = [];
      const stdin = request.stdin === null ? null : Buffer.from(request.stdin);
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stderrTruncated = false;
      let settled = false;
      const finish = (result?: CommandResult, error?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        stdin?.fill(0);
        for (const chunk of stdout) chunk.fill(0);
        stdout.length = 0;
        if (error !== undefined) rejectResult(error);
        else resolveResult(result!);
      };
      const abort = (code: string, message: string): void => {
        child.kill("SIGKILL");
        finish(undefined, new FoundationError(
          `lifecycle.execution.docker-cli-driver.${code}`,
          message,
          { retryable: true },
        ));
      };
      const timeout = setTimeout(() => abort(
        "command-timeout",
        "The selected Docker Engine command exceeded its fixed time bound",
      ), request.timeoutMilliseconds);
      timeout.unref();
      child.once("error", () => abort(
        "command-unavailable",
        "The exact configured Docker executable became unavailable",
      ));
      child.stdout.on("data", (chunk: Buffer) => {
        try {
          if (settled) return;
          stdoutBytes += chunk.byteLength;
          if (stdoutBytes > request.maximumStdoutBytes) {
            abort("command-output-bound", "Docker Engine output exceeded its fixed byte bound");
            return;
          }
          stdout.push(Buffer.from(chunk));
        } finally { chunk.fill(0); }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (!settled) {
          stderrBytes += chunk.byteLength;
          if (stderrBytes > request.maximumStderrBytes) stderrTruncated = true;
        }
        chunk.fill(0);
      });
      child.once("close", (exitCode, signal) => {
        if (settled) return;
        const bytes = new Uint8Array(stdoutBytes);
        let offset = 0;
        for (const chunk of stdout) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        finish(Object.freeze({ exitCode, signal, stdout: bytes, stderrTruncated }));
      });
      child.stdin.once("error", () => { stdin?.fill(0); abort("command-unavailable", "Private Docker command input became unavailable"); });
      child.stdin.once("close", () => stdin?.fill(0));
      if (stdin === null) child.stdin.end();
      else child.stdin.end(stdin, () => stdin.fill(0));
    });
  }
}

async function assertExactExecutable(path: string, expectedDigest: Sha256): Promise<void> {
  if (!isAbsolute(path) || normalize(path) !== path || path.includes("\0")) {
    fail("executable", "Docker executable selection is not one normalized absolute path");
  }
  let status;
  try {
    status = await lstat(path);
  } catch {
    fail("executable", "The exact configured Docker executable is unavailable", true);
  }
  if (!status.isFile() || status.isSymbolicLink() || (status.mode & 0o111) === 0 ||
      status.size < 1 || status.size > MAXIMUM_EXECUTABLE_BYTES) {
    fail("executable", "The configured Docker executable is not one bounded executable regular file");
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    fail("executable", "The exact configured Docker executable could not be read", true);
  }
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as Sha256;
  if (digest !== expectedDigest) fail("executable-substitution", "Docker executable content changed");
}

async function assertPrivateDockerConfigurationDirectory(path: string): Promise<void> {
  let status;
  try {
    status = await lstat(path);
  } catch {
    fail("configuration", "The selected private Docker configuration directory is unavailable", true);
  }
  if (!status.isDirectory() || status.isSymbolicLink() || status.uid !== process.getuid?.() ||
      (status.mode & 0o022) !== 0) {
    fail("configuration", "Docker configuration is not one exact private owned directory");
  }
}

function validateOptions(options: FoundationDockerCliEngineDriverOptionsV1): void {
  if (options.profile.profileId !== "lifecycle.execution-backend-profile.docker-local.v1" ||
      options.profile.backendKind !== "docker-local" || options.profile.usage !== "production" ||
      options.profile.engineContract.kind !== "docker-engine" ||
      options.profile.isolation.mechanism !== "oci-container") {
    fail("profile", "Docker CLI driver requires the exact production Docker Backend Profile");
  }
  if (!isSha256(options.dockerExecutableDigest)) {
    fail("configuration", "Docker executable digest is invalid");
  }
  if (!/^unix:\/\/\/[^\0\r\n]+$/u.test(options.engineEndpoint)) {
    fail("configuration", "Docker CLI driver requires one explicit local Unix Engine endpoint");
  }
  if (!isAbsolute(options.dockerConfigDirectory) ||
      normalize(options.dockerConfigDirectory) !== options.dockerConfigDirectory ||
      options.dockerConfigDirectory.includes("\0")) {
    fail("configuration", "Docker configuration directory is not one normalized absolute path");
  }
  if (options.images.length < 1 || options.images.length > 32) {
    fail("configuration", "Docker image installation selection is outside its fixed bound");
  }
  const identities = new Set<string>();
  for (const image of options.images) {
    assertFoundationDockerCliImageInstallationV1(image);
    const identity = `${image.imageId}\0${image.imageDigest}`;
    if (identities.has(identity)) fail("configuration", "Docker image installation is duplicated");
    identities.add(identity);
  }
  const provider = options.agentProviderSupport?.installation;
  if (provider !== undefined &&
      (!isSha256(provider.providerDescriptorDigest) ||
        !isSha256(provider.adapterImplementationDigest) ||
        !isSha256(provider.executableIdentity) ||
        !/^\d+\.\d+\.\d+$/u.test(provider.codexVersion) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(provider.model) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(provider.reasoning))) {
    fail("configuration", "Installed Agent provider support selection is invalid");
  }
}

/** The immutable Image installation contract is shared by fresh binding and retained recovery. */
export function assertFoundationDockerCliImageInstallationV1(image:FoundationDockerCliImageInstallationV1):void {
  if (image === null || typeof image !== "object" || Array.isArray(image) ||
      canonicalJson(Object.keys(image).sort()) !== canonicalJson([
        "imageId","imageDigest","immutableReference","configurationDigest","platform","nonRootUser",
        "runnerContractId","runnerContractDigest","runnerImplementationDigest","toolInventoryDigest",
        ...(image.agentProvider === undefined ? [] : ["agentProvider"]),
      ].sort()) || typeof image.imageId !== "string" || image.imageId === "" ||
      typeof image.immutableReference !== "string" || typeof image.nonRootUser !== "string" ||
      image.platform === null || typeof image.platform !== "object" ||
      canonicalJson(Object.keys(image.platform).sort()) !== canonicalJson(["architecture","os","variant"]) ||
      !["amd64","arm64"].includes(image.platform.architecture) ||
      (image.platform.variant !== null && typeof image.platform.variant !== "string")) {
    fail("configuration", "Docker image installation is incomplete or mutable");
  }
  const repositoryDigestReference =
    image.immutableReference.endsWith(`@${image.imageDigest}`);
  const localImageIdReference =
    image.immutableReference === image.imageDigest &&
    image.configurationDigest === image.imageDigest;
  if (!isSha256(image.imageDigest) || !isSha256(image.configurationDigest) ||
      !isSha256(image.runnerContractDigest) || !isSha256(image.runnerImplementationDigest) ||
      !isSha256(image.toolInventoryDigest) || image.runnerContractId !== RUNNER_CONTRACT_ID ||
      (!repositoryDigestReference && !localImageIdReference) ||
      image.nonRootUser === "" || /^(?:0|root)(?::0)?$/u.test(image.nonRootUser) ||
      image.platform.os !== "linux") {
    fail("configuration", "Docker image installation is incomplete or mutable");
  }
  if (image.agentProvider !== undefined &&
      (image.agentProvider === null || typeof image.agentProvider !== "object" ||
        canonicalJson(Object.keys(image.agentProvider).sort()) !== canonicalJson(["adapterImplementationDigest","codexVersion","executableIdentity"]) ||
        !/^\d+\.\d+\.\d+$/u.test(image.agentProvider.codexVersion) ||
        !isSha256(image.agentProvider.executableIdentity) ||
        !isSha256(image.agentProvider.adapterImplementationDigest))) {
    fail("configuration", "Docker Agent image provider installation is incomplete");
  }
}

function commandSucceeded(result: CommandResult): boolean {
  return result.exitCode === 0 && result.signal === null;
}

function dockerTerminalObservation(
  state: JsonRecord,
  cancelled: boolean,
): NonNullable<FoundationDockerCellDirectObservationV1["terminal"]> {
  if (typeof state.OOMKilled !== "boolean" || typeof state.Error !== "string") {
    fail("cell-integrity", "Docker Cell terminal state lacks exact failure facts");
  }
  const exitCode = integer(state.ExitCode, "Docker Cell exit code");
  const reason = cancelled
    ? "cancelled" as const
    : state.OOMKilled || state.Error.length > 0
      ? "backend-failure" as const
      : exitCode === 0 || exitCode === 70
        ? "exited" as const
        : "unknown" as const;
  return Object.freeze({
    finishedAt: exactIso(text(state.FinishedAt, "Docker Cell finish time")),
    reason,
    exitCode,
    signal: null,
    runnerDisposition: reason === "cancelled"
      ? "incomplete" as const
      : reason === "backend-failure" || reason === "unknown"
        ? "unavailable" as const
        : exitCode === 0
          ? "completed" as const
          : "refused" as const,
  });
}

function outputBound(maximumBytes: number, maximumEntries = 1): number {
  const overhead = Math.min(32 * 1024 * 1024, Math.max(1024 * 1024, maximumEntries * 2048));
  return Math.min(512 * 1024 * 1024, maximumBytes + overhead);
}

function readOctal(field: Uint8Array, label: string): number {
  const value = Buffer.from(field).toString("ascii").replace(/\0.*$/u, "").trim();
  if (!/^[0-7]+$/u.test(value)) fail("transport", `${label} is not one portable tar value`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("transport", `${label} exceeds its bound`);
  return parsed;
}

function readTarString(field: Uint8Array): string {
  const bytes = Buffer.from(field);
  const end = bytes.indexOf(0);
  const selected = end < 0 ? bytes : bytes.subarray(0, end);
  const value = selected.toString("utf8");
  if (!Buffer.from(value, "utf8").equals(selected)) fail("transport", "Docker archive text is not valid UTF-8");
  return value;
}

function paxPath(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PAX_HEADER_BYTES) {
    fail("transport", "Docker extended archive header exceeds its fixed bound");
  }
  const input = Buffer.from(bytes);
  const keys = new Set<string>();
  let offset = 0;
  let path: string | null = null;
  while (offset < input.byteLength) {
    const space = input.indexOf(0x20, offset);
    if (space < 0 || space - offset > 5) fail("transport", "Docker extended archive record has no bounded length");
    const digits = input.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/u.test(digits) || input.subarray(offset, space).some((byte) => byte < 0x30 || byte > 0x39)) {
      fail("transport", "Docker extended archive record length is invalid");
    }
    const length = Number(digits);
    const end = offset + length;
    if (end > input.byteLength || end <= space + 2 || input[end - 1] !== 0x0a) {
      fail("transport", "Docker extended archive record is truncated");
    }
    const recordBytes = input.subarray(space + 1, end - 1);
    const record = recordBytes.toString("utf8");
    if (!Buffer.from(record, "utf8").equals(recordBytes) || record.includes("\0")) {
      fail("transport", "Docker extended archive record text is invalid");
    }
    const equals = record.indexOf("=");
    const key = record.slice(0, equals);
    const value = record.slice(equals + 1);
    if (equals <= 0 || keys.has(key)) fail("transport", "Docker extended archive record key is invalid or repeated");
    keys.add(key);
    if (key === "path") {
      path = value;
    } else if (!["mtime", "atime", "ctime"].includes(key) || !/^-?[0-9]{1,20}(?:\.[0-9]{1,20})?$/u.test(value)) {
      fail("transport", "Docker extended archive header contains unsupported metadata");
    }
    offset = end;
  }
  return path;
}

function tarChecksum(block: Uint8Array): number {
  let sum = 0;
  for (let index = 0; index < block.byteLength; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : block[index]!;
  }
  return sum;
}

function parseBoundedTar(input: Uint8Array, maximumEntries: number, maximumBytes: number): readonly ArchiveEntry[] {
  if (input.byteLength > outputBound(maximumBytes, maximumEntries)) {
    fail("transport", "Docker archive exceeds its fixed transport bound");
  }
  const entries: ArchiveEntry[] = [];
  const paths = new Set<string>();
  let offset = 0;
  let aggregate = 0;
  let ended = false;
  let extended: Readonly<{ path: string | null }> | null = null;
  while (offset + TAR_BLOCK_BYTES <= input.byteLength) {
    const header = input.subarray(offset, offset + TAR_BLOCK_BYTES);
    offset += TAR_BLOCK_BYTES;
    if (header.every((byte) => byte === 0)) {
      ended = true;
      break;
    }
    const expectedChecksum = readOctal(header.subarray(148, 156), "Tar checksum");
    if (tarChecksum(header) !== expectedChecksum) fail("transport", "Docker archive checksum is invalid");
    const name = readTarString(header.subarray(0, 100));
    const prefix = readTarString(header.subarray(345, 500));
    let path = extended?.path ?? (prefix === "" ? name : `${prefix}/${name}`);
    while (path.startsWith("./")) path = path.slice(2);
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]!);
    const size = readOctal(header.subarray(124, 136), "Tar entry size");
    const mode = readOctal(header.subarray(100, 108), "Tar entry mode");
    const padded = Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
    if (offset + padded > input.byteLength) fail("transport", "Docker archive is truncated");
    if (type === "x") {
      if (extended !== null) fail("transport", "Docker archive repeats a pending extended header");
      extended = Object.freeze({ path: paxPath(input.subarray(offset, offset + size)) });
      offset += padded;
      continue;
    }
    extended = null;
    if (type === "5") {
      if (size !== 0) fail("transport", "Docker archive directory carries bytes");
      offset += padded;
      continue;
    }
    if (type !== "0") fail("transport", "Docker archive contains a linked or special entry");
    safePath(path, "Docker archive");
    if (paths.has(path)) fail("transport", "Docker archive contains a duplicate entry");
    paths.add(path);
    aggregate += size;
    if (!Number.isSafeInteger(aggregate) || aggregate > maximumBytes || entries.length >= maximumEntries) {
      fail("transport", "Docker archive exceeds its entry or byte bound");
    }
    entries.push(Object.freeze({
      path,
      bytes: Uint8Array.from(input.subarray(offset, offset + size)),
      modeClass: (mode & 0o111) === 0 ? "regular" as const : "executable" as const,
    }));
    offset += padded;
  }
  if (!ended || extended !== null || input.subarray(offset).some((byte) => byte !== 0)) {
    fail("transport", "Docker archive has no exact zero-padded end");
  }
  return Object.freeze(entries);
}

function tarPath(path: string): Readonly<{ name: string; prefix: string }> | null {
  const bytes = Buffer.byteLength(path, "utf8");
  if (bytes <= 100) return Object.freeze({ name: path, prefix: "" });
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix, "utf8") <= 155 && Buffer.byteLength(name, "utf8") <= 100) {
      return Object.freeze({ name, prefix });
    }
  }
  return null;
}

function writeTarText(header: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength > length) fail("transport", "Docker archive header value exceeds its bound");
  bytes.copy(header, offset);
}

function writeTarOctal(header: Buffer, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length > length - 1) fail("transport", "Docker archive numeric value exceeds its bound");
  writeTarText(header, offset, length, `${encoded}\0`);
}

function buildBoundedTar(
  entries: readonly ArchiveEntry[],
  ownership: Readonly<{ uid: number; gid: number }> = Object.freeze({ uid: 0, gid: 0 }),
): Uint8Array {
  const chunks: Buffer[] = [];
  const append = (split: Readonly<{ name: string; prefix: string }>, bytes: Uint8Array,
    mode: number, type: "0" | "x"): void => {
    const header = Buffer.alloc(TAR_BLOCK_BYTES);
    writeTarText(header, 0, 100, split.name);
    writeTarOctal(
      header,
      100,
      8,
      mode,
    );
    writeTarOctal(header, 108, 8, ownership.uid);
    writeTarOctal(header, 116, 8, ownership.gid);
    writeTarOctal(header, 124, 12, bytes.byteLength);
    writeTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = type.charCodeAt(0);
    writeTarText(header, 257, 6, "ustar\0");
    writeTarText(header, 263, 2, "00");
    writeTarText(header, 345, 155, split.prefix);
    const checksum = tarChecksum(header).toString(8).padStart(6, "0");
    writeTarText(header, 148, 6, checksum);
    header[154] = 0;
    header[155] = 0x20;
    chunks.push(header, Buffer.from(bytes));
    const padding = (TAR_BLOCK_BYTES - (bytes.byteLength % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  };
  for (const [index, entry] of entries.entries()) {
    safePath(entry.path, "Docker archive");
    let split = tarPath(entry.path);
    if (split === null) {
      // POSIX PAX preserves the exact logical path while retaining the fixed
      // 4096-byte path and archive bounds. No input identity is shortened.
      const suffix = ` path=${entry.path}\n`;
      let length = Buffer.byteLength(suffix, "utf8") + 1;
      while (String(length).length + Buffer.byteLength(suffix, "utf8") !== length) {
        length = String(length).length + Buffer.byteLength(suffix, "utf8");
      }
      const bytes = Buffer.from(`${length}${suffix}`, "utf8");
      if (bytes.byteLength > MAXIMUM_PAX_HEADER_BYTES) fail("transport", "Docker extended archive header exceeds its fixed bound");
      append({ name: `PaxHeaders/${index}`, prefix: "" }, bytes, 0o644, "x");
      split = { name: `PaxEntry.${index}`, prefix: "" };
    }
    append(split, entry.bytes, entry.portableMode ?? (entry.modeClass === "executable" ? 0o755 : 0o644), "0");
  }
  chunks.push(Buffer.alloc(TAR_BLOCK_BYTES * 2));
  return Uint8Array.from(Buffer.concat(chunks));
}

async function agentProviderSupportFrame(
  metadata: CellMetadata,
  subject: FoundationDockerProviderCredentialSubjectV1,
  resolver: FoundationDockerAgentProviderSupportResolverV1 | undefined,
): Promise<Uint8Array | null> {
  const support = metadata.providerSupport;
  if (support === null) return null;
  const installation = resolver?.installation;
  if (resolver === undefined || installation === undefined ||
      installation.providerDescriptorDigest !== support.providerDescriptorDigest ||
      installation.adapterImplementationDigest !== support.adapterImplementationDigest ||
      installation.executableIdentity !== support.executableIdentity ||
      installation.codexVersion !== support.codexVersion || installation.model !== support.model ||
      installation.reasoning !== support.reasoning) {
    fail("provider-support", "Retained Agent Cell no longer matches the installed Provider selection");
  }
  const reader = await resolver.openCredential({
    subject,
    credentialBinding: support.credentialBinding,
  });
  if (!isRecord(reader) || !Number.isSafeInteger(reader.byteLength) ||
      reader.byteLength < 2 || reader.byteLength > MAXIMUM_PROVIDER_AUTH_BYTES ||
      typeof reader.read !== "function") {
    fail("provider-support", "Installed provider authentication is not one bounded private reader");
  }
  const auth = Buffer.alloc(reader.byteLength);
  let byteLength = 0;
  try {
    for await (const raw of reader.read()) {
      if (!(raw instanceof Uint8Array) || raw.byteLength === 0) {
        fail("provider-support", "Installed provider authentication yielded invalid private bytes");
      }
      try {
        if (byteLength + raw.byteLength > auth.byteLength) {
          fail("provider-support", "Installed provider authentication exceeded its private byte bound");
        }
        auth.set(raw, byteLength);
        byteLength += raw.byteLength;
      } finally { raw.fill(0); }
    }
    if (byteLength !== auth.byteLength) fail("provider-support", "Installed provider authentication ended before its exact private length");
    const supportBytes = Buffer.from(`${canonicalJson(support)}\n`, "utf8");
    const header = Buffer.alloc(PROVIDER_SUPPORT_FRAME_MAGIC.byteLength + 8);
    PROVIDER_SUPPORT_FRAME_MAGIC.copy(header, 0);
    header.writeUInt32BE(supportBytes.byteLength, PROVIDER_SUPPORT_FRAME_MAGIC.byteLength);
    header.writeUInt32BE(auth.byteLength, PROVIDER_SUPPORT_FRAME_MAGIC.byteLength + 4);
    const frame = new Uint8Array(header.byteLength + supportBytes.byteLength + auth.byteLength);
    frame.set(header); frame.set(supportBytes, header.byteLength); frame.set(auth, header.byteLength + supportBytes.byteLength);
    return frame;
  } finally { auth.fill(0); }

}

async function readInputTransport(
  resolver: FoundationDockerInputSetTransportResolverV1,
  specification: FoundationExecutionSpecificationV1,
): Promise<Uint8Array> {
  const source = await resolver.open(specification);
  if (!isRecord(source) || !isRecord(source.inputSet) ||
      source.inputSetDigest !== specification.inputSet.digest ||
      source.inputSet.digest !== source.inputSetDigest ||
      source.inputSet.schema !== "lifecycle.execution-input-set.v2" ||
      selfDigest(source.inputSet) !== source.inputSet.digest ||
      typeof source.entries !== "function") {
    fail("input", "Docker input transport substituted its exact Input Set");
  }
  const entries: ArchiveEntry[] = [];
  const paths = new Set<string>([SPECIFICATION_PATH, INPUT_SET_PATH]);
  let aggregate = 0;
  for await (const reader of source.entries()) {
    if (!isRecord(reader) || typeof reader.path !== "string" ||
        !Number.isSafeInteger(reader.byteLength) || reader.byteLength < 0 ||
        !isSha256(reader.digest) ||
        (reader.modeClass !== "regular" && reader.modeClass !== "executable") ||
        typeof reader.read !== "function") {
      fail("input", "Docker input transport returned an invalid entry reader");
    }
    const path = safePath(reader.path, "Docker input");
    if (path.startsWith(".lifecycle/") || paths.has(path)) {
      fail("input", "Docker input transport entered a reserved or duplicate path");
    }
    paths.add(path);
    if (entries.length >= MAXIMUM_INPUT_ENTRIES || reader.byteLength > specification.limits.storageBytes) {
      fail("input", "Docker input transport exceeds its fixed entry or byte bound");
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    const hash = createHash("sha256");
    for await (const chunk of reader.read()) {
      if (!(chunk instanceof Uint8Array)) fail("input", "Docker input transport yielded invalid bytes");
      bytes += chunk.byteLength;
      aggregate += chunk.byteLength;
      if (!Number.isSafeInteger(bytes) || bytes > reader.byteLength ||
          !Number.isSafeInteger(aggregate) || aggregate > specification.limits.storageBytes) {
        fail("input", "Docker input transport exceeded its exact byte bound");
      }
      hash.update(chunk);
      chunks.push(Buffer.from(chunk));
    }
    const observedDigest = `sha256:${hash.digest("hex")}` as Sha256;
    if (bytes !== reader.byteLength || observedDigest !== reader.digest) {
      fail("input", "Docker input transport entry failed its exact byte binding");
    }
    entries.push(Object.freeze({ path, bytes: Uint8Array.from(Buffer.concat(chunks)), modeClass: reader.modeClass }));
  }
  const specificationBytes = Uint8Array.from(Buffer.from(`${canonicalJson(specification)}\n`, "utf8"));
  const inputSetBytes = Uint8Array.from(Buffer.from(`${canonicalJson(source.inputSet)}\n`, "utf8"));
  if (aggregate + specificationBytes.byteLength + inputSetBytes.byteLength >
      specification.limits.storageBytes) {
    fail("input", "Docker input transport leaves no room for fixed runner control bytes");
  }
  entries.push(Object.freeze({
    path: INPUT_SET_PATH,
    bytes: inputSetBytes,
    modeClass: "regular" as const,
  }));
  entries.push(Object.freeze({
    path: SPECIFICATION_PATH,
    bytes: specificationBytes,
    modeClass: "regular" as const,
  }));
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return buildBoundedTar(entries);
}

function encodedConfiguration(configuration: FoundationDockerCellCreateRequestV1["configuration"]): string {
  return safeLabel(Buffer.from(canonicalJson(configuration), "utf8").toString("base64url"), "Cell configuration");
}

function decodedConfiguration(value: string): FoundationDockerCellCreateRequestV1["configuration"] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    fail("cell-integrity", "Docker Cell private configuration metadata is invalid");
  }
  if (!isRecord(decoded) || !isSha256(decoded.digest) || selfDigest(decoded) !== decoded.digest) {
    fail("cell-integrity", "Docker Cell private configuration metadata failed its digest");
  }
  return Object.freeze(decoded) as FoundationDockerCellCreateRequestV1["configuration"];
}

function compileAgentProviderSupport(
  specification: FoundationExecutionSpecificationV1,
  image: FoundationDockerCliImageInstallationV1,
  resolver: FoundationDockerAgentProviderSupportResolverV1 | undefined,
): AgentProviderSupport | null {
  if (specification.owner.kind !== "agent-attempt" || specification.operation.kind !== "agent-attempt") {
    if (specification.credentialPolicy.mode !== "none" ||
        specification.networkPolicy.providerControlPlane !== "none") {
      fail("provider-support", "Non-Agent Cell selected provider support");
    }
    return null;
  }
  const installation = resolver?.installation;
  const imageProvider = image.agentProvider;
  const binding = specification.credentialPolicy.bindings[0];
  if (installation === undefined || imageProvider === undefined || binding === undefined ||
      specification.credentialPolicy.mode !== "fixed-runner" ||
      specification.credentialPolicy.bindings.length !== 1 || binding.id !== "provider-control" ||
      specification.credentialPolicy.agentAccess !== false ||
      specification.credentialPolicy.outputDisclosure !== false ||
      specification.networkPolicy.agentProductNetwork !== "none" ||
      specification.networkPolicy.providerControlPlane !== "fixed-service-channel" ||
      specification.networkPolicy.providerPolicyDigest === null ||
      specification.networkPolicy.separationRequired !== true ||
      installation.providerDescriptorDigest !== specification.operation.providerDescriptorDigest ||
      installation.adapterImplementationDigest !== specification.operation.adapterImplementationDigest ||
      imageProvider.adapterImplementationDigest !== installation.adapterImplementationDigest ||
      imageProvider.executableIdentity !== installation.executableIdentity ||
      imageProvider.codexVersion !== installation.codexVersion) {
    fail("provider-support", "Agent Cell lacks one exact installed fixed-runner provider selection");
  }
  const subject = Object.freeze({
    schema: PROVIDER_SUPPORT_SCHEMA,
    specificationDigest: specification.digest,
    attemptDigest: specification.owner.attempt.digest,
    providerDescriptorDigest: specification.operation.providerDescriptorDigest,
    adapterImplementationDigest: specification.operation.adapterImplementationDigest,
    executableIdentity: installation.executableIdentity,
    codexVersion: installation.codexVersion,
    model: installation.model,
    reasoning: installation.reasoning,
    credentialBinding: Object.freeze({ id: binding.id, policyDigest: binding.policyDigest }),
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject) }) as AgentProviderSupport;
}

function encodedProviderSupport(support: AgentProviderSupport): Readonly<{
  value: string;
  digest: Sha256;
}> {
  return Object.freeze({
    value: safeLabel(
      Buffer.from(canonicalJson(support), "utf8").toString("base64url"),
      "Agent provider support",
    ),
    digest: support.digest,
  });
}

function decodedProviderSupport(labels: JsonRecord): AgentProviderSupport | null {
  const encoded = labels[PRIVATE_LABELS.providerSupport];
  const digest = labels[PRIVATE_LABELS.providerSupportDigest];
  if (encoded === undefined && digest === undefined) return null;
  if (typeof encoded !== "string" || !isSha256(digest)) {
    fail("provider-support", "Docker Cell Agent provider support metadata is incomplete");
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
  catch { fail("provider-support", "Docker Cell Agent provider support metadata is invalid"); }
  if (!isRecord(value) || value.schema !== PROVIDER_SUPPORT_SCHEMA || value.digest !== digest ||
      selfDigest(value) !== digest || !isSha256(value.specificationDigest) ||
      !isSha256(value.attemptDigest) || !isSha256(value.providerDescriptorDigest) ||
      !isSha256(value.adapterImplementationDigest) || !isSha256(value.executableIdentity) ||
      typeof value.codexVersion !== "string" || typeof value.model !== "string" ||
      typeof value.reasoning !== "string" || !isRecord(value.credentialBinding) ||
      value.credentialBinding.id !== "provider-control" ||
      !isSha256(value.credentialBinding.policyDigest)) {
    fail("provider-support", "Docker Cell Agent provider support metadata failed its exact binding");
  }
  return Object.freeze(value) as AgentProviderSupport;
}

function encodedInspection(inspection: FoundationDockerCellInspectionV1): Readonly<{
  value: string;
  digest: Sha256;
}> {
  const canonical = canonicalJson(inspection);
  return Object.freeze({
    value: safeLabel(Buffer.from(canonical, "utf8").toString("base64url"), "Reclamation inspection"),
    digest: sha256Bytes(canonical),
  });
}

function decodedInspection(labels: JsonRecord, expectedCellId: string): FoundationDockerCellInspectionV1 {
  const encoded = privateLabel(labels, PRIVATE_LABELS.reclamationInspection);
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    fail("reclamation-anchor", "Docker Reclamation anchor inspection is invalid");
  }
  if (!isRecord(value) || value.schema !== "lifecycle.docker-cell-inspection.private.v1" ||
      value.cellId !== expectedCellId ||
      privateLabel(labels, PRIVATE_LABELS.reclamationInspectionDigest) !==
        sha256Bytes(canonicalJson(value))) {
    fail("reclamation-anchor", "Docker Reclamation anchor inspection is substituted");
  }
  const physicalPublic = publicLabels(labels);
  if (canonicalJson(value.labels) !== canonicalJson(physicalPublic)) {
    fail("reclamation-anchor", "Docker Reclamation anchor public binding is substituted");
  }
  return Object.freeze(value) as FoundationDockerCellInspectionV1;
}

function publicLabels(labels: unknown): Readonly<Record<string, string>> {
  const source = object(labels, "Docker Cell labels");
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (name.startsWith(PUBLIC_CELL_LABEL_PREFIX)) result[name] = text(value, "Docker Cell label");
  }
  return Object.freeze(result);
}

function privateLabel(labels: JsonRecord, name: string): string {
  const value = labels[name];
  if (typeof value !== "string" || value.includes("\0") ||
      Buffer.byteLength(value, "utf8") > MAXIMUM_CONFIGURATION_LABEL_BYTES) {
    fail("response", "Docker Cell private label is invalid in the selected Docker Engine response");
  }
  return value;
}

function exactTemporaryFilesystem(value: unknown, storageBytes: number): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value["/tmp"] !== "string") {
    return false;
  }
  const selected = new Set(value["/tmp"].split(","));
  const expected = new Set([
    "rw",
    "exec",
    "nosuid",
    "nodev",
    `size=${Math.min(storageBytes, 256 * 1024 * 1024)}`,
  ]);
  return selected.size === expected.size && [...selected].every((entry) => expected.has(entry));
}

function cellMetadata(labelsValue: unknown, images: readonly FoundationDockerCliImageInstallationV1[]): CellMetadata {
  const labels = object(labelsValue, "Docker Cell labels");
  if (privateLabel(labels, PRIVATE_LABELS.schema) !== DRIVER_SCHEMA ||
      privateLabel(labels, PRIVATE_LABELS.resourceKind) !== "cell") {
    fail("cell-integrity", "Docker Cell is not owned by the exact CLI driver contract");
  }
  const configuration = decodedConfiguration(privateLabel(labels, PRIVATE_LABELS.configuration));
  if (privateLabel(labels, PRIVATE_LABELS.configurationDigest) !== configuration.digest) {
    fail("cell-integrity", "Docker Cell configuration label is substituted");
  }
  const imageId = privateLabel(labels, PRIVATE_LABELS.imageId);
  const imageDigest = privateLabel(labels, PRIVATE_LABELS.imageDigest);
  const image = images.find((candidate) =>
    candidate.imageId === imageId && candidate.imageDigest === imageDigest
  );
  const providerSupport = decodedProviderSupport(labels);
  const providerNetwork = providerSupport === null
    ? null
    : safeName(privateLabel(labels, PRIVATE_LABELS.providerNetwork), "Provider-control network");
  const providerProxy = providerSupport === null
    ? null
    : safeName(privateLabel(labels, PRIVATE_LABELS.providerProxy), "Provider-control proxy");
  if (image === undefined || configuration.image.imageId !== imageId ||
      configuration.image.imageDigest !== imageDigest ||
      privateLabel(labels, PRIVATE_LABELS.specificationDigest) === "" ||
      (configuration.credentialPolicy.mode === "fixed-runner") !== (providerSupport !== null) ||
      (providerSupport !== null &&
        (providerSupport.specificationDigest !==
          privateLabel(labels, PRIVATE_LABELS.specificationDigest) ||
          privateLabel(labels, PRIVATE_LABELS.providerStateVolume) !== `${privateLabel(labels, PRIVATE_LABELS.allocationName)}-provider-state` ||
          image.agentProvider?.executableIdentity !== providerSupport.executableIdentity ||
          image.agentProvider?.adapterImplementationDigest !==
            providerSupport.adapterImplementationDigest))) {
    fail("cell-integrity", "Docker Cell image or Specification metadata is substituted");
  }
  return Object.freeze({
    configuration,
    publicLabels: publicLabels(labels),
    inputVolume: safeName(privateLabel(labels, PRIVATE_LABELS.inputVolume), "Docker input volume"),
    outputVolume: safeName(privateLabel(labels, PRIVATE_LABELS.outputVolume), "Docker output volume"),
    providerStateVolume: providerSupport === null ? null :
      safeName(privateLabel(labels, PRIVATE_LABELS.providerStateVolume), "Docker provider-state volume"),
    image,
    providerSupport,
    providerNetwork,
    providerProxy,
    allocationName: safeName(
      privateLabel(labels, PRIVATE_LABELS.allocationName),
      "Docker allocation name",
    ),
  });
}

function commandLabels(labels: Readonly<Record<string, string>>): string[] {
  return Object.entries(labels).flatMap(([name, value]) => ["--label", `${name}=${value}`]);
}

function volumeLabels(kind: "input" | "output" | "provider-state" | "dispatch" | "cancel" | "reclamation", input: Readonly<{
  allocationName: string;
  specificationDigest: Sha256;
  cellId?: string;
}>): Readonly<Record<string, string>> {
  return Object.freeze({
    [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
    [PRIVATE_LABELS.resourceKind]: kind,
    [PRIVATE_LABELS.allocationName]: input.allocationName,
    [PRIVATE_LABELS.specificationDigest]: input.specificationDigest,
    ...(input.cellId === undefined ? {} : { [PRIVATE_LABELS.cellId]: input.cellId }),
  });
}

function parseManifest(bytes: Uint8Array): FoundationExecutionOutputManifestV1 {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail("output", "Docker output Manifest is not JSON");
  }
  assertFoundationSchema(OUTPUT_MANIFEST_SCHEMA_ID, value, "execution-output-manifest.json");
  if (!isRecord(value) || !isSha256(value.digest) || selfDigest(value) !== value.digest) {
    fail("output", "Docker output Manifest failed its exact self digest");
  }
  return Object.freeze(value) as FoundationExecutionOutputManifestV1;
}

function retrievedOutput(
  archive: Uint8Array,
  input: Readonly<{
    specificationDigest: Sha256;
    inputSetDigest: Sha256;
    imageDigest: Sha256;
    outputContractDigest: Sha256;
    runnerContractDigest: Sha256;
    maximumEntries: number;
    maximumBytes: number;
    maximumEntryBytes: number;
  }>,
): FoundationRetrievedExecutionOutputV1 | null {
  const entries = parseBoundedTar(archive, input.maximumEntries + 1, input.maximumBytes + 1024 * 1024);
  const manifestEntry = entries.find(({ path }) => path === OUTPUT_MANIFEST_PATH);
  if (manifestEntry === undefined) return null;
  const manifest = parseManifest(manifestEntry.bytes);
  if (manifest.specificationDigest !== input.specificationDigest ||
      manifest.inputSetDigest !== input.inputSetDigest || manifest.imageDigest !== input.imageDigest ||
      manifest.outputContractDigest !== input.outputContractDigest ||
      manifest.runnerDigest !== input.runnerContractDigest ||
      manifest.entryCount !== manifest.entries.length || manifest.entryCount > input.maximumEntries ||
      manifest.aggregateByteLength > input.maximumBytes) {
    fail("output", "Docker output Manifest substituted its exact execution binding");
  }
  const carried = entries.filter(({ path }) => path !== OUTPUT_MANIFEST_PATH);
  if (carried.length !== manifest.entries.length) fail("output", "Docker output archive has extra or missing entries");
  const byPath = new Map(carried.map((entry) => [entry.path, entry] as const));
  let aggregate = 0;
  const readers: FoundationExecutionOutputEntryReaderV1[] = [];
  for (const declared of manifest.entries) {
    const entry = byPath.get(declared.path);
    if (entry === undefined || entry.modeClass !== declared.modeClass ||
        entry.bytes.byteLength !== declared.byteLength || declared.byteLength > input.maximumEntryBytes ||
        sha256Bytes(entry.bytes) !== declared.digest) {
      fail("output", "Docker output archive differs from its exact Manifest inventory");
    }
    aggregate += entry.bytes.byteLength;
    const snapshot = Uint8Array.from(entry.bytes);
    readers.push(Object.freeze({
      path: declared.path,
      byteLength: declared.byteLength,
      digest: declared.digest,
      async *read() {
        if (snapshot.byteLength > 0) yield Uint8Array.from(snapshot);
      },
    }));
  }
  if (aggregate !== manifest.aggregateByteLength) fail("output", "Docker output aggregate byte length is invalid");
  return Object.freeze({
    manifest,
    carrierByteLength: aggregate,
    async *entries() {
      for (const reader of readers) yield reader;
    },
  });
}

class DockerCliEngineDriver implements FoundationDockerEngineDriverV1 {
  readonly #options: InternalOptions;
  readonly #environment: Readonly<Record<string, string>>;
  readonly #endpointDigest: Sha256;
  #engine: FoundationDockerEngineDescriptionV1 | null = null;
  readonly #imageLabels = new Map<string, Readonly<Record<string, string>>>();

  constructor(options: InternalOptions) {
    this.#options = options;
    this.#environment = dockerEnvironment(options);
    this.#endpointDigest = sha256Bytes(Buffer.from(options.engineEndpoint, "utf8"));
  }

  async #command(
    arguments_: readonly string[],
    input: Readonly<{
      stdin?: Uint8Array;
      maximumStdoutBytes?: number;
      timeoutMilliseconds?: number;
      allowFailure?: boolean;
    }> = {},
  ): Promise<CommandResult> {
    if (this.#options.verifyExecutable) {
      await assertExactExecutable(this.#options.dockerExecutable, this.#options.dockerExecutableDigest);
    }
    const result = await this.#options.commandExecutor.execute(Object.freeze({
      executable: this.#options.dockerExecutable,
      arguments: Object.freeze(["--host", this.#options.engineEndpoint, ...arguments_]),
      environment: this.#environment,
      stdin: input.stdin ?? null,
      timeoutMilliseconds: input.timeoutMilliseconds ?? 30_000,
      maximumStdoutBytes: input.maximumStdoutBytes ?? MAXIMUM_COMMAND_OUTPUT_BYTES,
      maximumStderrBytes: 64 * 1024,
    }));
    if (!input.allowFailure && !commandSucceeded(result)) {
      fail("engine-command", "The selected Docker Engine could not complete an exact operation", true);
    }
    return result;
  }

  #image(imageId: string, imageDigest: Sha256): FoundationDockerCliImageInstallationV1 {
    const selected = this.#options.images.filter((image) =>
      image.imageId === imageId && image.imageDigest === imageDigest
    );
    if (selected.length !== 1) fail("image", "Execution Image is not one exact installed Docker image");
    return selected[0]!;
  }

  async #inheritedImageLabels(image: FoundationDockerCliImageInstallationV1): Promise<Readonly<Record<string, string>>> {
    const key = `${image.imageId}\0${image.imageDigest}`;
    if (!this.#imageLabels.has(key)) {
      await this.inspectImage({ imageId: image.imageId, imageDigest: image.imageDigest,
        runnerContractId: image.runnerContractId, runnerContractDigest: image.runnerContractDigest });
    }
    return this.#imageLabels.get(key)!;
  }

  async describe(): Promise<FoundationDockerEngineDescriptionV1> {
    const versionResult = await this.#command(["version", "--format", "{{json .Server}}"]);
    const version = object(json(versionResult.stdout, "Docker Engine version"), "Docker Engine version");
    const infoResult = await this.#command(["info", "--format", "{{json .}}"]);
    const info = object(json(infoResult.stdout, "Docker Engine information"), "Docker Engine information");
    const apiVersion = text(
      version.ApiVersion ?? version.APIVersion,
      "Docker Engine API version",
    );
    if (!apiVersionAtLeast(apiVersion, this.#options.profile.engineContract.compatibleVersion)) {
      fail("engine-version", "Docker Engine does not satisfy the selected API compatibility profile");
    }
    const os = text(info.OSType ?? version.Os, "Docker Engine operating system");
    if (os !== "linux") fail("engine-platform", "Docker Engine is not a Linux container engine");
    const architecture = parseArchitecture(info.Architecture ?? version.Arch);
    const serverId = text(info.ID, "Docker Engine identity");
    const engineIdentityDigest = selfDigest({
      schema: "lifecycle.docker-engine-identity.private.v1",
      endpointDigest: this.#endpointDigest,
      serverId,
      apiVersion,
      version: text(version.Version, "Docker Engine version"),
      os,
      architecture,
    });
    const description = Object.freeze({
      schema: "lifecycle.docker-engine-description.private.v1" as const,
      engineIdentityDigest,
      contractDigest: this.#options.profile.engineContract.contractDigest,
      compatibilityProfileId: this.#options.profile.engineContract.compatibilityProfileId,
      compatibleVersion: this.#options.profile.engineContract.compatibleVersion,
      platform: Object.freeze({ os: "linux" as const, architecture, variant: null }),
    });
    if (this.#engine !== null && canonicalJson(this.#engine) !== canonicalJson(description)) {
      fail("engine-substitution", "The selected Docker Engine identity changed");
    }
    this.#engine = description;
    return description;
  }

  async inspectImage(input: Readonly<{
    imageId: string;
    imageDigest: Sha256;
    runnerContractId: typeof RUNNER_CONTRACT_ID;
    runnerContractDigest: Sha256;
  }>): Promise<FoundationDockerImageObservationV1> {
    const installed = this.#image(input.imageId, input.imageDigest);
    if (input.runnerContractId !== installed.runnerContractId ||
        input.runnerContractDigest !== installed.runnerContractDigest) {
      fail("image", "Execution Image runner selection is substituted");
    }
    const result = await this.#command([
      "image", "inspect", installed.immutableReference, "--format", "{{json .}}",
    ]);
    const observation = object(json(result.stdout, "Docker image inspection"), "Docker image inspection");
    const labels = object(object(observation.Config, "Docker image configuration").Labels, "Docker image labels");
    const repositoryDigests = observation.RepoDigests;
    const observedConfiguration = text(observation.Id, "Docker image configuration identity");
    const immutableIdentity = installed.immutableReference === installed.imageDigest
      ? observedConfiguration === installed.imageDigest
      : Array.isArray(repositoryDigests) && repositoryDigests.some(
          (value) => typeof value === "string" && value.endsWith(`@${installed.imageDigest}`),
        );
    if (!immutableIdentity || observedConfiguration !== installed.configurationDigest ||
        text(observation.Os, "Docker image operating system") !== installed.platform.os ||
        parseArchitecture(observation.Architecture) !== installed.platform.architecture ||
        text(object(observation.Config, "Docker image configuration").User, "Docker image user") !== installed.nonRootUser ||
        labels[`${IMAGE_LABEL_PREFIX}image-id`] !== installed.imageId ||
        labels[`${IMAGE_LABEL_PREFIX}runner-contract-id`] !== installed.runnerContractId ||
        labels[`${IMAGE_LABEL_PREFIX}runner-contract-digest`] !== installed.runnerContractDigest ||
        labels[`${IMAGE_LABEL_PREFIX}runner-implementation-digest`] !== installed.runnerImplementationDigest ||
        labels[`${IMAGE_LABEL_PREFIX}tool-inventory-digest`] !== installed.toolInventoryDigest ||
        (installed.agentProvider !== undefined &&
          (installed.agentProvider.adapterImplementationDigest !==
              installed.runnerImplementationDigest ||
            labels[`${IMAGE_LABEL_PREFIX}codex-version`] !== installed.agentProvider.codexVersion ||
            labels[`${IMAGE_LABEL_PREFIX}codex-executable-identity`] !==
              installed.agentProvider.executableIdentity ||
            labels[`${IMAGE_LABEL_PREFIX}adapter-implementation-digest`] !==
              installed.agentProvider.adapterImplementationDigest))) {
      fail("image-substitution", "Docker image content does not match its installed immutable record");
    }
    // Docker inherits every image label. The digest-verified configuration,
    // not a subset of selected label names, supplies that complete baseline.
    const inherited = Object.freeze(Object.fromEntries(Object.entries(labels).map(([name, value]) => {
      if (typeof value !== "string") fail("image-substitution", "Docker image label is not exact text");
      return [safeLabel(name, "Docker image label name"), safeLabel(value, "Docker image label value")];
    })));
    const labelKey = `${installed.imageId}\0${installed.imageDigest}`;
    const priorLabels = this.#imageLabels.get(labelKey);
    if (priorLabels !== undefined && canonicalJson(priorLabels) !== canonicalJson(inherited)) {
      fail("image-substitution", "Docker image inherited labels changed under the selected digest");
    }
    this.#imageLabels.set(labelKey, inherited);
    return Object.freeze({
      schema: "lifecycle.docker-image-observation.private.v1" as const,
      imageId: installed.imageId,
      imageDigest: installed.imageDigest,
      platform: installed.platform,
      immutableReference: true as const,
      nonRootRunner: true as const,
      runnerContractId: installed.runnerContractId,
      runnerContractDigest: installed.runnerContractDigest,
      runnerAndToolInventoryVerified: true as const,
    });
  }

  async #containerIds(labels: Readonly<Record<string, string>>, maximumResults: number): Promise<readonly string[]> {
    const arguments_ = ["container", "ls", "--all", "--no-trunc"];
    for (const [name, value] of Object.entries(labels)) {
      arguments_.push("--filter", `label=${name}=${value}`);
    }
    arguments_.push("--format", "{{.ID}}");
    const result = await this.#command(arguments_, { maximumStdoutBytes: 16 * 1024 });
    const ids = Buffer.from(result.stdout).toString("utf8").split(/\r?\n/u).filter(Boolean);
    if (ids.some((id) => id.length !== 64 || !/^[a-f0-9]{64}$/u.test(id))) fail("discovery", "Docker discovery returned an invalid Cell identity");
    return Object.freeze(ids.slice(0, maximumResults + 1));
  }

  async findCells(input: Readonly<{
    labels: Readonly<Record<string, string>>;
    maximumResults: 2;
  }>): Promise<FoundationDockerCellDiscoveryV1> {
    const ids = await this.#containerIds(input.labels, input.maximumResults);
    const anchorNames = await this.#volumeNamesByLabels(Object.freeze({
      ...input.labels,
      [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
      [PRIVATE_LABELS.resourceKind]: "reclamation",
    }), input.maximumResults);
    const cellsById = new Map<string, FoundationDockerCellInspectionV1>();
    for (const id of ids.slice(0, input.maximumResults)) {
      const inspection = await this.inspectCell(id);
      if (inspection !== null) cellsById.set(id, inspection);
    }
    for (const name of anchorNames.slice(0, input.maximumResults)) {
      const labels = await this.#volumeLabels(name);
      if (labels === null) continue;
      const cellId = privateLabel(labels, PRIVATE_LABELS.cellId);
      if (!/^[a-f0-9]{64}$/u.test(cellId) || name !== this.#reclamationAnchorName(cellId)) {
        fail("reclamation-anchor", "Docker Reclamation discovery is substituted");
      }
      if (!cellsById.has(cellId)) {
        const inspection = await this.#reclamationAnchorInspection(cellId);
        if (inspection !== null) cellsById.set(cellId, inspection);
      }
    }
    const cells = [...cellsById.values()];
    return Object.freeze({
      cells: Object.freeze(cells.slice(0, input.maximumResults)),
      truncated: ids.length > input.maximumResults ||
        anchorNames.length > input.maximumResults || cells.length > input.maximumResults,
    });
  }

  async findCellIdentities(input: Readonly<{
    labels: Readonly<Record<string, string>>;
    maximumResults: 2;
  }>): Promise<FoundationDockerCellIdentityDiscoveryV1> {
    // Both domains are observed afresh. A reclamation anchor remains an
    // allocation identity even after its physical Cell has been removed.
    const ids = await this.#containerIds(input.labels, input.maximumResults);
    const anchorNames = await this.#volumeNamesByLabels(Object.freeze({
      ...input.labels,
      [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
      [PRIVATE_LABELS.resourceKind]: "reclamation",
    }), input.maximumResults);
    const cellIds = new Set(ids.slice(0, input.maximumResults));
    for (const name of anchorNames.slice(0, input.maximumResults)) {
      const labels = await this.#volumeLabels(name);
      if (labels === null) continue;
      const cellId = privateLabel(labels, PRIVATE_LABELS.cellId);
      if (cellId.length !== 64 || !/^[a-f0-9]{64}$/u.test(cellId) ||
          name !== this.#reclamationAnchorName(cellId) ||
          labels[PRIVATE_LABELS.schema] !== DRIVER_SCHEMA ||
          labels[PRIVATE_LABELS.resourceKind] !== "reclamation" ||
          !Object.entries(input.labels).every(([key, value]) => labels[key] === value)) {
        fail("reclamation-anchor", "Docker Reclamation discovery is substituted");
      }
      const inspection = decodedInspection(labels, cellId);
      assertFoundationDockerCellInspectionV1(inspection);
      cellIds.add(cellId);
    }
    return Object.freeze({
      cellIds: Object.freeze([...cellIds].slice(0, input.maximumResults)),
      truncated: ids.length > input.maximumResults || anchorNames.length > input.maximumResults ||
        cellIds.size > input.maximumResults || new Set(ids).size !== ids.length ||
        new Set(anchorNames).size !== anchorNames.length,
    });
  }

  async allocationResourcesAbsent(input: Readonly<{
    allocationName: string;
    specificationDigest: Sha256;
  }>): Promise<boolean> {
    const name = safeName(input.allocationName, "Docker allocation name");
    if (!isSha256(input.specificationDigest)) fail("allocation-absence", "Docker allocation Specification is invalid");
    const labels = [
      `${PRIVATE_LABELS.allocationName}=${name}`,
      `${PRIVATE_LABELS.specificationDigest}=${input.specificationDigest}`,
      `io.lifecycle.execution-cell.v1.specification-digest=${input.specificationDigest}`,
    ];
    // Name checks catch substituted labels; label checks catch renamed resources,
    // including dispatch/cancellation markers and Reclamation anchors.
    const queries: string[][] = [];
    for (const label of labels) {
      queries.push(["container", "ls", "--all", "--no-trunc", "--filter", `label=${label}`, "--format", "{{.ID}}"]);
      queries.push(["volume", "ls", "--filter", `label=${label}`, "--format", "{{.Name}}"]);
      queries.push(["network", "ls", "--no-trunc", "--filter", `label=${label}`, "--format", "{{.ID}}"]);
    }
    for (const selected of [name, `${name}-input-stage`, `${name}-provider-proxy`, `${name}-provider-state-read`]) {
      queries.push(["container", "ls", "--all", "--no-trunc", "--filter", `name=^/${selected}$`, "--format", "{{.ID}}"]);
    }
    for (const selected of [`${name}-input`, `${name}-output`, `${name}-provider-state`]) {
      queries.push(["volume", "ls", "--filter", `name=^${selected}$`, "--format", "{{.Name}}"]);
    }
    queries.push(["network", "ls", "--no-trunc", "--filter", `name=^${name}-provider-net$`, "--format", "{{.ID}}"]);
    for (const query of queries) {
      const observed = await this.#command(query, { maximumStdoutBytes: 4096 });
      if (observed.stdout.byteLength !== 0) return false;
    }
    return true;
  }

  async #inspectContainer(cellId: string): Promise<JsonRecord | null> {
    if (!/^[a-f0-9]{64}$/u.test(cellId)) fail("cell", "Docker Cell identity is invalid");
    const filtered = await this.#command([
      "container", "ls", "--all", "--no-trunc", "--filter", `id=${cellId}`, "--format", "{{.ID}}",
    ], { maximumStdoutBytes: 1024 });
    const matches = Buffer.from(filtered.stdout).toString("utf8").split(/\r?\n/u).filter(Boolean);
    if (!matches.includes(cellId)) return null;
    const result = await this.#command(["container", "inspect", cellId, "--format", "{{json .}}"]);
    return object(json(result.stdout, "Docker Cell inspection"), "Docker Cell inspection");
  }

  async #volumeLabels(name: string): Promise<JsonRecord | null> {
    const listed = await this.#command([
      "volume", "ls", "--filter", `name=^${name}$`, "--format", "{{.Name}}",
    ], { maximumStdoutBytes: 4096 });
    const names = Buffer.from(listed.stdout).toString("utf8").split(/\r?\n/u).filter(Boolean);
    if (!names.includes(name)) return null;
    const result = await this.#command(["volume", "inspect", name, "--format", "{{json .Labels}}"]);
    return object(json(result.stdout, "Docker volume labels"), "Docker volume labels");
  }

  async #volumeNamesByLabels(
    labels: Readonly<Record<string, string>>,
    maximumResults: number,
  ): Promise<readonly string[]> {
    const arguments_ = ["volume", "ls"];
    for (const [name, value] of Object.entries(labels)) {
      arguments_.push("--filter", `label=${name}=${value}`);
    }
    arguments_.push("--format", "{{.Name}}");
    const result = await this.#command(arguments_, { maximumStdoutBytes: 16 * 1024 });
    const names = Buffer.from(result.stdout).toString("utf8").split(/\r?\n/u).filter(Boolean);
    for (const name of names) safeName(name, "Docker volume discovery result");
    return Object.freeze(names.slice(0, maximumResults + 1));
  }

  #reclamationAnchorName(cellId: string): string {
    return safeName(`lifecycle-reclamation-${cellId}`, "Docker Reclamation anchor");
  }

  async #reclamationAnchorInspection(
    cellId: string,
  ): Promise<FoundationDockerCellInspectionV1 | null> {
    const labels = await this.#volumeLabels(this.#reclamationAnchorName(cellId));
    if (labels === null) return null;
    if (labels[PRIVATE_LABELS.schema] !== DRIVER_SCHEMA ||
        labels[PRIVATE_LABELS.resourceKind] !== "reclamation" ||
        labels[PRIVATE_LABELS.cellId] !== cellId) {
      fail("reclamation-anchor", "Docker Reclamation anchor identity is substituted");
    }
    const retained = decodedInspection(labels, cellId);
    const sequence = await this.#options.observationSequence.next(cellId);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence <= retained.direct.observationSequence) {
      fail("observation-sequence", "Docker Reclamation observation sequence did not advance");
    }
    const observedAt = this.#options.now?.() ?? new Date().toISOString();
    if (new Date(observedAt).toISOString() !== observedAt) fail("clock", "Docker observation clock is invalid");
    return Object.freeze({
      ...retained,
      direct: Object.freeze({ ...retained.direct, observationSequence: sequence, observedAt }),
    });
  }

  async #markerState(kind: "dispatch" | "cancel", cellId: string, specificationDigest: Sha256): Promise<boolean> {
    const name = safeName(`lifecycle-${kind}-${cellId}`, `Docker ${kind} marker`);
    const labels = await this.#volumeLabels(name);
    if (labels === null) return false;
    const expected = volumeLabels(kind, { allocationName: cellId, specificationDigest, cellId });
    if (canonicalJson(labels) !== canonicalJson(expected)) {
      fail("marker-integrity", `Docker ${kind} marker identity is substituted`);
    }
    return true;
  }

  async #removeExactMarker(
    kind: "dispatch" | "cancel",
    cellId: string,
    specificationDigest: Sha256,
  ): Promise<"removed" | "missing" | "remaining" | "integrity-refusal"> {
    const name = safeName(`lifecycle-${kind}-${cellId}`, `Docker ${kind} marker`);
    const expected = volumeLabels(kind, {
      allocationName: cellId,
      specificationDigest,
      cellId,
    });
    const matching = await this.#volumeNamesByLabels(expected, 2);
    const labels = await this.#volumeLabels(name);
    if (matching.some((selected) => selected !== name) || matching.length > 1) {
      return "integrity-refusal";
    }
    if (labels === null) {
      return matching.length === 0 ? "missing" : "integrity-refusal";
    }
    if (canonicalJson(labels) !== canonicalJson(expected) ||
        matching.length !== 1 || matching[0] !== name) {
      return "integrity-refusal";
    }
    await this.#command(
      ["volume", "rm", name],
      { allowFailure: true, maximumStdoutBytes: 4096 },
    );
    const afterLabels = await this.#volumeLabels(name);
    const afterMatching = await this.#volumeNamesByLabels(expected, 2);
    if (afterLabels === null && afterMatching.length === 0) return "removed";
    if (afterMatching.some((selected) => selected !== name) || afterMatching.length > 1 ||
        (afterLabels !== null && canonicalJson(afterLabels) !== canonicalJson(expected))) {
      return "integrity-refusal";
    }
    return "remaining";
  }

  async #readOutputArchive(cellId: string, maximumBytes: number, maximumEntries: number): Promise<Uint8Array | null> {
    const result = await this.#command([
      "container", "cp", `${cellId}:${OUTPUT_ROOT}/.`, "-",
    ], {
      allowFailure: true,
      maximumStdoutBytes: outputBound(maximumBytes + 1024 * 1024, maximumEntries + 1),
      timeoutMilliseconds: 120_000,
    });
    if (!commandSucceeded(result)) return null;
    return result.stdout;
  }

  async inspectCell(cellId: string): Promise<FoundationDockerCellInspectionV1 | null> {
    return await this.#inspectCell(cellId, true);
  }

  async #inspectCell(
    cellId: string,
    allowMembershipReobservation: boolean,
  ): Promise<FoundationDockerCellInspectionV1 | null> {
    const inspected = await this.#inspectContainer(cellId);
    if (inspected === null) return await this.#reclamationAnchorInspection(cellId);
    const config = object(inspected.Config, "Docker Cell configuration");
    const metadata = cellMetadata(config.Labels, this.#options.images);
    const observedId = text(inspected.Id, "Docker Cell identity");
    if (observedId !== cellId ||
        text(inspected.Image, "Docker Cell immutable image") !== metadata.image.configurationDigest) {
      fail("cell-integrity", "Docker Cell identity or immutable image is substituted");
    }
    const host = object(inspected.HostConfig, "Docker Cell host configuration");
    const restart = object(host.RestartPolicy, "Docker Cell restart policy");
    const mounts = inspected.Mounts;
    const inputMount = Array.isArray(mounts)
      ? mounts.find((mount) => isRecord(mount) && mount.Name === metadata.inputVolume)
      : undefined;
    const outputMount = Array.isArray(mounts)
      ? mounts.find((mount) => isRecord(mount) && mount.Name === metadata.outputVolume)
      : undefined;
    const authenticatedAgent = metadata.providerSupport !== null;
    const providerStateMount = Array.isArray(mounts)
      ? mounts.find((mount) => isRecord(mount) && mount.Name === metadata.providerStateVolume)
      : undefined;
    if (authenticatedAgent) {
      const expected = volumeLabels("provider-state", {
        allocationName: metadata.allocationName,
        specificationDigest: metadata.providerSupport!.specificationDigest,
      });
      const labels = await this.#volumeLabels(metadata.providerStateVolume!);
      if (labels === null || canonicalJson(labels) !== canonicalJson(expected)) {
        fail("cell-integrity", "Docker provider-state volume identity is substituted or unavailable");
      }
    }
    const securityOptions = Array.isArray(host.SecurityOpt) ? host.SecurityOpt : [];
    const environment = Array.isArray(config.Env) ? config.Env : [];
    const providerProxyUrl = `http://${PROVIDER_CONTROL_ALIAS}:${PROVIDER_CONTROL_PORT}`;
    const expectedProviderEnvironment = [
      `HTTP_PROXY=${providerProxyUrl}`,
      `HTTPS_PROXY=${providerProxyUrl}`,
      `http_proxy=${providerProxyUrl}`,
      `https_proxy=${providerProxyUrl}`,
    ];
    if (host.Privileged !== false || host.ReadonlyRootfs !== true ||
        host.NetworkMode !== (authenticatedAgent ? metadata.providerNetwork : "none") ||
        host.PidMode !== "" || restart.Name !== "no" || !Array.isArray(mounts) ||
        canonicalJson(config.Entrypoint) !== canonicalJson([RUNNER_ENTRYPOINT]) ||
        canonicalJson(config.Cmd) !== canonicalJson([
          "execute", "--specification", `${INPUT_ROOT}/${SPECIFICATION_PATH}`,
          "--input", INPUT_ROOT, "--output", OUTPUT_ROOT,
        ]) ||
        mounts.length !== (authenticatedAgent ? 3 : 2) || inputMount === undefined || outputMount === undefined ||
        (authenticatedAgent && (providerStateMount === undefined || providerStateMount.Type !== "volume" ||
          providerStateMount.Destination !== PROVIDER_STATE_ROOT || providerStateMount.RW !== true)) ||
        inputMount.Type !== "volume" || inputMount.Destination !== INPUT_ROOT || inputMount.RW !== false ||
        outputMount.Type !== "volume" || outputMount.Destination !== OUTPUT_ROOT || outputMount.RW !== true ||
        !(host.Binds === null || (Array.isArray(host.Binds) && host.Binds.length === 0)) ||
        config.User !== metadata.image.nonRootUser ||
        !Array.isArray(host.CapDrop) || !host.CapDrop.includes("ALL") ||
        !securityOptions.includes("no-new-privileges") ||
        (authenticatedAgent && !securityOptions.includes("seccomp=unconfined")) ||
        (!authenticatedAgent && securityOptions.includes("seccomp=unconfined")) ||
        (authenticatedAgent && (!expectedProviderEnvironment.every((entry) =>
          environment.includes(entry)) || environment.some((entry) =>
          typeof entry !== "string" || /^(?:CODEX_HOME|OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN)=/u.test(entry)))) ||
        !exactTemporaryFilesystem(host.Tmpfs, metadata.configuration.limits.storageBytes)) {
      fail("cell-integrity", "Docker Cell no longer has its exact hardened configuration");
    }
    const state = object(inspected.State, "Docker Cell state");
    const running = state.Running === true;
    const status = text(state.Status, "Docker Cell process status");
    const processState: FoundationDockerCellDirectObservationV1["processState"] = running
      ? "running"
      : status === "created"
        ? "not-started"
        : status === "exited" || status === "dead"
          ? "terminal"
          : "ambiguous";
    const specificationDigest = privateLabel(object(config.Labels, "Docker Cell labels"), PRIVATE_LABELS.specificationDigest) as Sha256;
    if (!isSha256(specificationDigest)) fail("cell-integrity", "Docker Cell Specification digest is invalid");
    const dispatch = await this.#markerState("dispatch", cellId, specificationDigest);
    const cancelled = await this.#markerState("cancel", cellId, specificationDigest);
    let providerProxyRunning = false;
    if (authenticatedAgent) {
      if (metadata.providerProxy === null || metadata.providerNetwork === null) {
        fail("provider-channel-integrity", "Agent Cell lacks its provider-control coordinate");
      }
      const providerLabels = Object.freeze({
        ...await this.#inheritedImageLabels(metadata.image),
        [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
        [PRIVATE_LABELS.resourceKind]: "provider-control",
        [PRIVATE_LABELS.allocationName]: metadata.allocationName,
        [PRIVATE_LABELS.specificationDigest]: specificationDigest,
      });
      const proxy = await this.#providerProxy(metadata.providerProxy, providerLabels);
      const network = await this.#network(metadata.providerNetwork);
      if (proxy === null || network === null || network.Internal !== true || canonicalJson(
        object(network.Labels, "Docker provider-control network labels"),
      ) !== canonicalJson(Object.freeze({
        [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
        [PRIVATE_LABELS.resourceKind]: "provider-network",
        [PRIVATE_LABELS.allocationName]: metadata.allocationName,
        [PRIVATE_LABELS.specificationDigest]: specificationDigest,
      }))) {
        fail("provider-channel-integrity", "Agent provider-control resources are absent or substituted");
      }
      const proxyConfig = object(proxy.Config, "Docker provider-control proxy configuration");
      const proxyHost = object(proxy.HostConfig, "Docker provider-control proxy host configuration");
      const proxyRestart = object(proxyHost.RestartPolicy, "Docker provider-control restart policy");
      const proxySecurity = Array.isArray(proxyHost.SecurityOpt) ? proxyHost.SecurityOpt : [];
      const networkMembers = Object.keys(
        object(network.Containers ?? {}, "Docker provider-control network members"),
      ).sort();
      const cellNetworks = object(
        object(inspected.NetworkSettings, "Docker Cell network settings").Networks,
        "Docker Cell configured networks",
      );
      const proxyNetworks = object(
        object(proxy.NetworkSettings, "Docker provider-control proxy network settings").Networks,
        "Docker provider-control proxy configured networks",
      );
      const proxyProviderNetwork = object(
        proxyNetworks[metadata.providerNetwork],
        "Docker provider-control proxy internal network",
      );
      const proxyAliases = Array.isArray(proxyProviderNetwork.Aliases)
        ? proxyProviderNetwork.Aliases
        : Array.isArray(proxyProviderNetwork.DNSNames)
          ? proxyProviderNetwork.DNSNames
          : [];
      const proxyId = text(proxy.Id, "Docker provider-control proxy identity");
      const expectedNetworkMembers = new Set([cellId, proxyId]);
      if (proxyHost.Privileged !== false || proxyHost.ReadonlyRootfs !== true ||
          proxyHost.NetworkMode !== "bridge" || proxyRestart.Name !== "no" ||
          !Array.isArray(proxyHost.CapDrop) || !proxyHost.CapDrop.includes("ALL") ||
          !proxySecurity.includes("no-new-privileges") ||
          proxyConfig.User !== metadata.image.nonRootUser ||
          canonicalJson(proxyConfig.Entrypoint) !== canonicalJson([RUNNER_ENTRYPOINT]) ||
          canonicalJson(proxyConfig.Cmd) !== canonicalJson([
            "provider-control-proxy",
            "--specification-digest", specificationDigest,
            "--policy-digest", metadata.configuration.networkPolicy.providerPolicyDigest,
            "--wall-time-milliseconds",
            String(metadata.configuration.limits.wallTimeMilliseconds),
          ]) ||
          canonicalJson(Object.keys(cellNetworks).sort()) !==
            canonicalJson([metadata.providerNetwork]) ||
          canonicalJson(Object.keys(proxyNetworks).sort()) !==
            canonicalJson(["bridge", metadata.providerNetwork].sort()) ||
          !proxyAliases.includes(PROVIDER_CONTROL_ALIAS) ||
          networkMembers.some((member) => !expectedNetworkMembers.has(member))) {
        fail("provider-channel-integrity", "Agent provider-control topology is substituted");
      }
      if (processState === "running" &&
          (networkMembers.length !== 2 || !networkMembers.includes(cellId) ||
            !networkMembers.includes(proxyId))) {
        // Docker snapshots the Cell before its network membership. A natural
        // exit between those reads can detach an expected member. Discard this
        // mixed read once and revalidate the complete exact configuration; a
        // persistent missing member still refuses without publishing a fact.
        if (allowMembershipReobservation) return await this.#inspectCell(cellId, false);
        fail("provider-channel-integrity", "Running Agent provider-control membership is incomplete");
      }
      const proxyState = object(proxy.State, "Docker provider-control proxy state");
      providerProxyRunning = proxyState.Running === true;
      if (processState === "running" && !providerProxyRunning) {
        fail("provider-channel-unavailable", "Running Agent Cell lost its bounded provider-control channel", true);
      }
    }
    const archive = processState === "terminal"
      ? await this.#readOutputArchive(
          cellId,
          metadata.configuration.limits.outputBytes,
          metadata.configuration.limits.outputEntries,
        )
      : null;
    let output: FoundationDockerCellDirectObservationV1["output"] = Object.freeze({
      disposition: processState === "terminal" ? "unavailable" as const : "not-produced" as const,
      manifestDigest: null,
      carrierByteLength: null,
    });
    let outputBytes: number | null = processState === "not-started" ? 0 : null;
    if (archive !== null) {
      try {
        const parsed = parseBoundedTar(
          archive,
          metadata.configuration.limits.outputEntries + 1,
          metadata.configuration.limits.outputBytes + 1024 * 1024,
        );
        const manifestEntry = parsed.find(({ path }) => path === OUTPUT_MANIFEST_PATH);
        if (manifestEntry !== undefined) {
          const manifest = parseManifest(manifestEntry.bytes);
          output = Object.freeze({
            disposition: "complete" as const,
            manifestDigest: manifest.digest,
            carrierByteLength: manifest.aggregateByteLength,
          });
          outputBytes = manifest.aggregateByteLength;
        } else {
          output = Object.freeze({
            disposition: "missing" as const,
            manifestDigest: null,
            carrierByteLength: null,
          });
        }
      } catch (error) {
        if (!(error instanceof FoundationError) ||
            (!error.code.startsWith("lifecycle.execution.docker-cli-driver.transport") &&
              !error.code.startsWith("lifecycle.execution.docker-cli-driver.output") &&
              error.code !== "lifecycle.schema.invalid")) throw error;
        output = Object.freeze({ disposition: "partial" as const, manifestDigest: null, carrierByteLength: null });
      }
    }
    const sequence = await this.#options.observationSequence.next(cellId);
    if (!Number.isSafeInteger(sequence) || sequence < 1) fail("observation-sequence", "Docker observation sequence owner returned an invalid value");
    const observedAt = this.#options.now?.() ?? new Date().toISOString();
    if (new Date(observedAt).toISOString() !== observedAt) fail("clock", "Docker observation clock is invalid");
    const contained = (processState === "not-started" || processState === "terminal") &&
      !providerProxyRunning;
    let credentials: FoundationDockerCellDirectObservationV1["containmentFacts"]["credentials"] =
      authenticatedAgent ? "unverified" : "not-injected";
    let providerChannel: FoundationDockerCellDirectObservationV1["containmentFacts"]["providerChannel"] =
      authenticatedAgent ? "unverified" : "not-granted";
    if (authenticatedAgent && processState === "not-started") {
      credentials = "not-injected";
      providerChannel = "not-granted";
    } else if (authenticatedAgent && processState === "terminal" && !providerProxyRunning) {
      credentials = "revoked";
      providerChannel = "unreachable";
    } else if (authenticatedAgent && (processState === "running" || providerProxyRunning)) {
      const support = await this.#command([
        "container", "exec", cellId,
        "/usr/bin/test", "-r", `${PROVIDER_STATE_ROOT}/home/auth.json`,
      ], { allowFailure: true, maximumStdoutBytes: 1024 });
      if (commandSucceeded(support)) {
        credentials = "active";
        providerChannel = "reachable";
      }
    }
    const startedAtValue = typeof state.StartedAt === "string" && !/^0{4}-/u.test(state.StartedAt)
      ? new Date(state.StartedAt).getTime()
      : null;
    const finishedAtValue = typeof state.FinishedAt === "string" && !/^0{4}-/u.test(state.FinishedAt)
      ? new Date(state.FinishedAt).getTime()
      : null;
    const wallTime = startedAtValue === null
      ? 0
      : Math.max(0, (finishedAtValue ?? Date.parse(observedAt)) - startedAtValue);
    const direct: FoundationDockerCellDirectObservationV1 = Object.freeze({
      observationSequence: sequence,
      observedAt,
      dispatchMarker: dispatch ? "consumed" as const : "not-consumed" as const,
      processState,
      terminal: processState === "terminal"
        ? dockerTerminalObservation(state, cancelled)
        : null,
      containmentFacts: Object.freeze({
        rootProcess: processState === "not-started" ? "not-started" as const
          : processState === "running" ? "running" as const
            : processState === "terminal" ? "terminal" as const : "unverified" as const,
        descendants: contained ? "absent" as const
          : processState === "running" || providerProxyRunning ? "present" as const : "unverified" as const,
        writers: contained ? "absent" as const
          : processState === "running" || providerProxyRunning ? "present" as const : "unverified" as const,
        credentials,
        providerChannel,
        outputMutation: contained ? "impossible" as const : processState === "running" ? "possible" as const : "unverified" as const,
      }),
      output,
      resourceFacts: Object.freeze({
        wallTimeMilliseconds: wallTime,
        cpuTimeMilliseconds: null,
        peakMemoryBytes: null,
        storageBytes: outputBytes,
        outputBytes,
        eventCount: null,
        limitBreaches: Object.freeze(wallTime > metadata.configuration.limits.wallTimeMilliseconds
          ? ["wall-time" as const]
          : []),
      }),
    });
    return Object.freeze({
      schema: "lifecycle.docker-cell-inspection.private.v1" as const,
      cellId,
      engineIdentityDigest: (this.#engine ?? await this.describe()).engineIdentityDigest,
      labels: metadata.publicLabels,
      configuration: metadata.configuration,
      direct,
    });
  }

  async #ensureVolume(name: string, labels: Readonly<Record<string, string>>): Promise<void> {
    const existing = await this.#volumeLabels(name);
    if (existing !== null) {
      if (canonicalJson(existing) !== canonicalJson(labels)) fail("volume-integrity", "Docker transport volume identity is substituted");
      return;
    }
    const result = await this.#command(["volume", "create", ...commandLabels(labels), name], { allowFailure: true });
    const observed = await this.#volumeLabels(name);
    if (observed === null || canonicalJson(observed) !== canonicalJson(labels)) {
      if (!commandSucceeded(result)) fail("volume-create", "Docker transport volume creation is unavailable", true);
      fail("volume-integrity", "Docker transport volume creation returned another identity");
    }
  }

  async #resetProvisionalVolume(
    name: string,
    labels: Readonly<Record<string, string>>,
  ): Promise<void> {
    const existing = await this.#volumeLabels(name);
    if (existing !== null) {
      if (canonicalJson(existing) !== canonicalJson(labels)) {
        fail("volume-integrity", "Docker provisional transport volume identity is substituted");
      }
      const removal = await this.#command(
        ["volume", "rm", name],
        { allowFailure: true, maximumStdoutBytes: 4096 },
      );
      if (!commandSucceeded(removal) || await this.#volumeLabels(name) !== null) {
        fail("volume-reset", "Docker provisional transport volume could not be reset", true);
      }
    }
    await this.#ensureVolume(name, labels);
  }

  async #removeContainerByName(
    name: string,
    expectedLabels: Readonly<Record<string, string>>,
  ): Promise<void> {
    const result = await this.#command([
      "container", "ls", "--all", "--no-trunc", "--filter", `name=^/${name}$`, "--format", "{{.ID}}",
    ], { maximumStdoutBytes: 4096 });
    const ids = Buffer.from(result.stdout).toString("utf8").split(/\r?\n/u).filter(Boolean);
    if (ids.length > 1) fail("staging-integrity", "Docker input staging selection is ambiguous");
    if (ids.length === 1) {
      const inspected = await this.#inspectContainer(ids[0]!);
      if (inspected === null || canonicalJson(
        object(object(inspected.Config, "Docker staging configuration").Labels, "Docker staging labels"),
      ) !== canonicalJson(expectedLabels)) {
        fail("staging-integrity", "Docker input staging coordinate is substituted");
      }
      await this.#command(["container", "rm", "--force", ids[0]!]);
    }
  }

  async #network(name: string): Promise<JsonRecord | null> {
    const listed = await this.#command([
      "network", "ls", "--filter", `name=^${name}$`, "--format", "{{.Name}}",
    ], { maximumStdoutBytes: 4096 });
    const names = Buffer.from(listed.stdout).toString("utf8").split(/\r?\n/u).filter(Boolean);
    if (!names.includes(name)) return null;
    const inspected = await this.#command([
      "network", "inspect", name, "--format", "{{json .}}",
    ]);
    return object(json(inspected.stdout, "Docker provider-control network"),
      "Docker provider-control network");
  }

  async #resetProviderNetwork(
    name: string,
    labels: Readonly<Record<string, string>>,
  ): Promise<void> {
    const existing = await this.#network(name);
    if (existing !== null) {
      if (existing.Internal !== true || canonicalJson(
        object(existing.Labels, "Docker provider-control network labels"),
      ) !== canonicalJson(labels) ||
          Object.keys(object(existing.Containers ?? {}, "Docker provider-control network members"))
            .length !== 0) {
        fail("provider-channel-integrity", "Docker provider-control network is substituted");
      }
      const removed = await this.#command(
        ["network", "rm", name],
        { allowFailure: true, maximumStdoutBytes: 4096 },
      );
      if (!commandSucceeded(removed) || await this.#network(name) !== null) {
        fail("provider-channel-reset", "Docker provider-control network could not be reset", true);
      }
    }
    const created = await this.#command([
      "network", "create", "--driver", "bridge", "--internal",
      ...commandLabels(labels), name,
    ], { allowFailure: true, maximumStdoutBytes: 4096 });
    const observed = await this.#network(name);
    if (!commandSucceeded(created) || observed === null || observed.Internal !== true ||
        canonicalJson(object(observed.Labels, "Docker provider-control network labels")) !==
          canonicalJson(labels)) {
      fail("provider-channel-create", "Docker provider-control network creation was not proven", true);
    }
  }

  async #providerProxy(
    name: string,
    expectedLabels: Readonly<Record<string, string>>,
  ): Promise<JsonRecord | null> {
    const listed = await this.#command([
      "container", "ls", "--all", "--no-trunc", "--filter", `name=^/${name}$`,
      "--format", "{{.ID}}",
    ], { maximumStdoutBytes: 4096 });
    const ids = Buffer.from(listed.stdout).toString("utf8").split(/\r?\n/u).filter(Boolean);
    if (ids.length === 0) return null;
    if (ids.length !== 1 || !/^[a-f0-9]{64}$/u.test(ids[0]!)) {
      fail("provider-channel-integrity", "Docker provider-control proxy selection is ambiguous");
    }
    const inspected = await this.#inspectContainer(ids[0]!);
    if (inspected === null || canonicalJson(
      object(object(inspected.Config, "Docker provider-control proxy configuration").Labels,
        "Docker provider-control proxy labels"),
    ) !== canonicalJson(expectedLabels)) {
      fail("provider-channel-integrity", "Docker provider-control proxy identity is substituted");
    }
    return inspected;
  }

  async #credentialSubject(specificationDigest: Sha256, allocationName: string): Promise<FoundationDockerProviderCredentialSubjectV1> {
    return Object.freeze({ specificationDigest,
      engineIdentityDigest: (this.#engine ?? await this.describe()).engineIdentityDigest,
      allocationName: safeName(allocationName, "Docker credential allocation"),
    });
  }

  async #credentialSelection(specification: FoundationExecutionSpecificationV1, allocationName: string): Promise<FoundationDockerProviderCredentialSelectionV1 | null> {
    if (specification.credentialPolicy.mode === "none") return null;
    if (specification.credentialPolicy.mode !== "fixed-runner" || specification.credentialPolicy.bindings.length !== 1 ||
        this.#options.agentProviderSupport === undefined) fail("provider-support", "Provider credential settlement lacks its exact custodian");
    return Object.freeze({ subject: await this.#credentialSubject(specification.digest, allocationName),
      credentialBinding: specification.credentialPolicy.bindings[0]!,
    });
  }

  #credentialReadLabels(allocationName: string, specificationDigest: Sha256): Readonly<Record<string, string>> {
    return Object.freeze({ [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
      [PRIVATE_LABELS.resourceKind]: "provider-state-read", [PRIVATE_LABELS.allocationName]: allocationName,
      [PRIVATE_LABELS.specificationDigest]: specificationDigest,
    });
  }

  async #readProviderCredential(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    allocationName: string;
    volume: string;
  }>): Promise<Uint8Array | null> {
    const image = this.#image(input.specification.image.imageId, input.specification.image.imageDigest);
    const name = safeName(`${input.allocationName}-provider-state-read`, "Provider-state reader");
    const labels = this.#credentialReadLabels(input.allocationName, input.specification.digest);
    const physicalLabels = Object.freeze({ ...await this.#inheritedImageLabels(image), ...labels });
    await this.#removeContainerByName(name, physicalLabels);
    try {
      const created = await this.#command([
        "container", "create", "--name", name, ...commandLabels(labels),
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--network", "none", "--restart", "no", "--user", image.nonRootUser,
        "--log-driver", "none", "--pids-limit", "16",
        "--mount", `type=volume,src=${input.volume},dst=${PROVIDER_STATE_ROOT},readonly`,
        "--entrypoint", RUNNER_ENTRYPOINT, image.immutableReference, "provider-credential-read",
      ], { maximumStdoutBytes: 4096 });
      const cellId = Buffer.from(created.stdout).toString("utf8").trim();
      const inspected = /^[a-f0-9]{64}$/u.test(cellId) ? await this.#inspectContainer(cellId) : null;
      if (inspected === null) fail("provider-state-read", "Private credential reader could not be identified", true);
      const config = object(inspected.Config, "Private credential reader configuration");
      const host = object(inspected.HostConfig, "Private credential reader host configuration");
      const mounts = inspected.Mounts;
      if (inspected.Id !== cellId || inspected.Image !== image.configurationDigest ||
          canonicalJson(config.Labels) !== canonicalJson(physicalLabels) || config.User !== image.nonRootUser ||
          canonicalJson(config.Entrypoint) !== canonicalJson([RUNNER_ENTRYPOINT]) ||
          canonicalJson(config.Cmd) !== canonicalJson(["provider-credential-read"]) ||
          host.Privileged !== false || host.ReadonlyRootfs !== true || host.NetworkMode !== "none" ||
          host.PidMode !== "" || object(host.RestartPolicy, "Private credential reader restart policy").Name !== "no" ||
          object(host.LogConfig, "Private credential reader logging policy").Type !== "none" ||
          !Array.isArray(host.CapDrop) || !host.CapDrop.includes("ALL") ||
          !Array.isArray(host.SecurityOpt) || !host.SecurityOpt.includes("no-new-privileges") ||
          !(host.Binds === null || (Array.isArray(host.Binds) && host.Binds.length === 0)) ||
          !Array.isArray(mounts) || mounts.length !== 1 || !isRecord(mounts[0]) ||
          mounts[0].Type !== "volume" || mounts[0].Name !== input.volume ||
          mounts[0].Destination !== PROVIDER_STATE_ROOT || mounts[0].RW !== false) {
        fail("provider-state-read", "Private credential reader physical configuration is substituted");
      }
      const result = await this.#command(["container", "start", "--attach", cellId], {
        maximumStdoutBytes: MAXIMUM_PROVIDER_AUTH_BYTES + PROVIDER_CREDENTIAL_FRAME_MAGIC.byteLength + 4,
        allowFailure: true,
      });
      try {
        if (!commandSucceeded(result)) fail("provider-state-read", "Private credential retrieval is temporarily unavailable", true);
        const frame = Buffer.from(result.stdout);
        try {
          const headerLength = PROVIDER_CREDENTIAL_FRAME_MAGIC.byteLength + 4;
          if (frame.byteLength < headerLength ||
              !frame.subarray(0, PROVIDER_CREDENTIAL_FRAME_MAGIC.byteLength).equals(PROVIDER_CREDENTIAL_FRAME_MAGIC)) {
            fail("provider-state-read", "Private credential reader returned an invalid bounded frame");
          }
          const length = frame.readUInt32BE(PROVIDER_CREDENTIAL_FRAME_MAGIC.byteLength);
          if (length > MAXIMUM_PROVIDER_AUTH_BYTES || (length !== 0 && length < 2) || frame.byteLength !== headerLength + length) {
            fail("provider-state-read", "Private credential reader returned invalid frame bounds");
          }
          return length === 0 ? null : Uint8Array.from(frame.subarray(headerLength));
        } finally { frame.fill(0); }
      } finally { result.stdout.fill(0); }
    } finally {
      await this.#removeContainerByName(name, physicalLabels);
    }
  }

  async settleProviderCredential(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    allocationName: string;
    cellId: string | null;
  }>): Promise<void> {
    const selection = await this.#credentialSelection(input.specification, input.allocationName);
    if (selection === null) return;
    const resolver = this.#options.agentProviderSupport!;
    // A durable settlement wins over stale Cell bytes after an interrupted return.
    if (await resolver.credentialSettlement(selection)) return;
    if (input.cellId === null) {
      if (!await resolver.hasCredentialClaim(selection)) return;
      await resolver.settleCredential({ ...selection, outcome: Object.freeze({ kind: "unused" }) });
      return;
    }
    const container = await this.#inspectContainer(input.cellId);
    if (container !== null) {
      const metadata = cellMetadata(object(container.Config, "Docker Cell configuration").Labels, this.#options.images);
      if (metadata.allocationName !== input.allocationName || metadata.providerSupport?.specificationDigest !== input.specification.digest) {
        fail("provider-support", "Credential settlement selected another Cell");
      }
      const inspection = await this.inspectCell(input.cellId);
      if (inspection === null || !["terminal", "not-started"].includes(inspection.direct.processState) ||
          inspection.direct.containmentFacts.descendants !== "absent" ||
          inspection.direct.containmentFacts.writers !== "absent" ||
          !["not-granted", "unreachable"].includes(inspection.direct.containmentFacts.providerChannel)) {
        fail("provider-support", "Credential settlement requires exact Cell containment", true);
      }
      if (inspection.direct.processState === "not-started" && inspection.direct.containmentFacts.credentials === "not-injected") {
        await resolver.settleCredential({ ...selection, outcome: Object.freeze({ kind: "unused" }) });
        return;
      }
    }
    if (container === null) {
      const image = this.#image(input.specification.image.imageId, input.specification.image.imageDigest);
      const proxyLabels = Object.freeze({ ...await this.#inheritedImageLabels(image),
        [PRIVATE_LABELS.schema]: DRIVER_SCHEMA, [PRIVATE_LABELS.resourceKind]: "provider-control",
        [PRIVATE_LABELS.allocationName]: input.allocationName, [PRIVATE_LABELS.specificationDigest]: input.specification.digest,
      });
      const proxyName = `${input.allocationName}-provider-proxy`;
      let proxy = await this.#providerProxy(proxyName, proxyLabels);
      if (proxy !== null && object(proxy.State, "Provider-control state").Running === true) {
        // The productive Cell is absent; the exact surviving private proxy is
        // still ours to contain. Missing Cell custody never licenses redispatch.
        await this.#command(["container", "stop", "--time", "5", proxyName], { allowFailure: true, maximumStdoutBytes: 4096 });
        proxy = await this.#providerProxy(proxyName, proxyLabels);
        if (proxy !== null && object(proxy.State, "Provider-control state").Running === true) {
          await this.#command(["container", "kill", proxyName], { allowFailure: true, maximumStdoutBytes: 4096 });
          proxy = await this.#providerProxy(proxyName, proxyLabels);
        }
      }
      if (proxy !== null && object(proxy.State, "Provider-control state").Running !== false) {
        fail("provider-support", "Credential settlement requires provider containment", true);
      }
    }
    const volume = safeName(`${input.allocationName}-provider-state`, "Docker provider-state volume");
    const expected = volumeLabels("provider-state", { allocationName: input.allocationName, specificationDigest: input.specification.digest });
    const labels = await this.#volumeLabels(volume);
    const matching = await this.#volumeNamesByLabels(expected, 2);
    if ((labels !== null && canonicalJson(labels) !== canonicalJson(expected)) ||
        matching.some(name => name !== volume) || matching.length > 1) {
      fail("provider-support", "Credential state volume identity is substituted");
    }
    const bytes = labels === null ? null : await this.#readProviderCredential({ ...input, volume });
    try {
      await resolver.settleCredential({ ...selection,
        outcome: bytes === null ? Object.freeze({ kind: "lost" }) : Object.freeze({ kind: "updated", bytes }),
      });
    } finally { bytes?.fill(0); }
  }

  async forgetProviderCredential(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    allocationName: string;
  }>): Promise<void> {
    const selection = await this.#credentialSelection(input.specification, input.allocationName);
    if (selection !== null) await this.#options.agentProviderSupport!.forgetCredentialSettlement(selection);
  }

  async createCell(request: FoundationDockerCellCreateRequestV1): Promise<void> {
    const { specification, configuration } = request;
    if (configuration.transport.input !== "bounded-archive" ||
        configuration.transport.output !== "bounded-archive" ||
        specification.networkPolicy.agentProductNetwork !== "none") {
      fail("unsupported", "Docker CLI driver supports only bounded archive transport and no Agent product network");
    }
    const image = this.#image(configuration.image.imageId, configuration.image.imageDigest);
    const providerSupport = compileAgentProviderSupport(
      specification,
      image,
      this.#options.agentProviderSupport,
    );
    if (providerSupport === null &&
        (specification.networkPolicy.providerControlPlane !== "none" ||
          specification.credentialPolicy.mode !== "none")) {
      fail("unsupported", "Cell provider support selection is incomplete");
    }
    await this.inspectImage({
      imageId: image.imageId,
      imageDigest: image.imageDigest,
      runnerContractId: RUNNER_CONTRACT_ID,
      runnerContractDigest: specification.runner.contractDigest,
    });
    const allocationName = safeName(request.allocationName, "Docker allocation name");
    const inputVolume = safeName(`${allocationName}-input`, "Docker input volume");
    const outputVolume = safeName(`${allocationName}-output`, "Docker output volume");
    const providerStateVolume = providerSupport === null ? null :
      safeName(`${allocationName}-provider-state`, "Docker provider-state volume");
    const inputLabels = volumeLabels("input", { allocationName, specificationDigest: specification.digest });
    const outputLabels = volumeLabels("output", { allocationName, specificationDigest: specification.digest });
    const stagingName = safeName(`${allocationName}-input-stage`, "Docker input staging name");
    const stagingLabels = Object.freeze({
      [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
      [PRIVATE_LABELS.resourceKind]: "input-stage",
      [`${PRIVATE_LABEL_PREFIX}allocation-name`]: allocationName,
      [PRIVATE_LABELS.specificationDigest]: specification.digest,
      [PRIVATE_LABELS.inputVolume]: inputVolume,
    });
    const stagingPhysicalLabels = Object.freeze({
      ...await this.#inheritedImageLabels(image),
      ...stagingLabels,
    });
    // Validate and bound the complete logical input before allocating physical
    // transport resources. A deterministic input refusal therefore cannot
    // leave an untracked pre-Handle Docker obligation.
    const archive = await readInputTransport(this.#options.inputTransport, specification);
    if (providerSupport !== null) {
      await this.#options.agentProviderSupport!.claimCredential({
        subject: await this.#credentialSubject(specification.digest, allocationName),
        credentialBinding: providerSupport.credentialBinding,
      });
    }
    await this.#removeContainerByName(stagingName, stagingPhysicalLabels);
    // No Cell exists when the Backend enters createCell. Any exact volumes at
    // this coordinate are therefore an interrupted provisional creation, not
    // reusable input. Reset them before materialization so stale extra entries
    // cannot survive a lost staging response.
    await this.#resetProvisionalVolume(inputVolume, inputLabels);
    await this.#resetProvisionalVolume(outputVolume, outputLabels);
    if (providerStateVolume !== null) {
      await this.#resetProvisionalVolume(providerStateVolume, volumeLabels("provider-state", {
        allocationName, specificationDigest: specification.digest,
      }));
    }
    await this.#command([
      "container", "create", "--name", stagingName,
      ...commandLabels(stagingLabels),
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--network", "none", "--restart", "no", "--user", image.nonRootUser,
      "--mount", `type=volume,src=${inputVolume},dst=${INPUT_ROOT}`,
      "--entrypoint", RUNNER_ENTRYPOINT,
      image.immutableReference, "transport-stage",
    ]);
    try {
      await this.#command(["container", "cp", "-", `${stagingName}:${INPUT_ROOT}`], {
        stdin: archive,
        timeoutMilliseconds: 120_000,
      });
    } finally {
      await this.#removeContainerByName(stagingName, stagingPhysicalLabels);
    }
    const configurationEncoded = encodedConfiguration(configuration);
    const providerSupportEncoded = providerSupport === null
      ? null
      : encodedProviderSupport(providerSupport);
    const providerNetwork = providerSupport === null
      ? null
      : safeName(`${allocationName}-provider-net`, "Provider-control network");
    const providerProxy = providerSupport === null
      ? null
      : safeName(`${allocationName}-provider-proxy`, "Provider-control proxy");
    const privateLabels = Object.freeze({
      [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
      [PRIVATE_LABELS.resourceKind]: "cell",
      [PRIVATE_LABELS.allocationName]: allocationName,
      [PRIVATE_LABELS.configuration]: configurationEncoded,
      [PRIVATE_LABELS.configurationDigest]: configuration.digest,
      [PRIVATE_LABELS.inputVolume]: inputVolume,
      [PRIVATE_LABELS.outputVolume]: outputVolume,
      [PRIVATE_LABELS.imageId]: image.imageId,
      [PRIVATE_LABELS.imageDigest]: image.imageDigest,
      [PRIVATE_LABELS.specificationDigest]: specification.digest,
      ...(providerSupportEncoded === null ? {} : {
        [PRIVATE_LABELS.providerSupport]: providerSupportEncoded.value,
        [PRIVATE_LABELS.providerSupportDigest]: providerSupportEncoded.digest,
        [PRIVATE_LABELS.providerNetwork]: providerNetwork!,
        [PRIVATE_LABELS.providerProxy]: providerProxy!,
        [PRIVATE_LABELS.providerStateVolume]: providerStateVolume!,
      }),
    });
    const authenticatedAgent = providerSupport !== null;
    if (authenticatedAgent) {
      const providerResourceLabels = Object.freeze({
        ...await this.#inheritedImageLabels(image),
        [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
        [PRIVATE_LABELS.resourceKind]: "provider-control",
        [PRIVATE_LABELS.allocationName]: allocationName,
        [PRIVATE_LABELS.specificationDigest]: specification.digest,
      });
      await this.#removeContainerByName(providerProxy!, providerResourceLabels);
      const providerNetworkLabels = Object.freeze({
        [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
        [PRIVATE_LABELS.resourceKind]: "provider-network",
        [PRIVATE_LABELS.allocationName]: allocationName,
        [PRIVATE_LABELS.specificationDigest]: specification.digest,
      });
      await this.#resetProviderNetwork(providerNetwork!, providerNetworkLabels);
      await this.#command([
        "container", "create", "--name", providerProxy!,
        ...commandLabels(providerResourceLabels),
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--network", "bridge", "--restart", "no", "--pids-limit", "64",
        "--user", image.nonRootUser,
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=1048576",
        "--entrypoint", RUNNER_ENTRYPOINT,
        image.immutableReference,
        "provider-control-proxy",
        "--specification-digest", specification.digest,
        "--policy-digest", specification.networkPolicy.providerPolicyDigest!,
        "--wall-time-milliseconds", String(specification.limits.wallTimeMilliseconds),
      ]);
      await this.#command([
        "network", "connect", "--alias", PROVIDER_CONTROL_ALIAS,
        providerNetwork!, providerProxy!,
      ]);
    }
    await this.#command([
      "container", "create", "--name", allocationName,
      ...commandLabels(request.labels), ...commandLabels(privateLabels),
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      ...(authenticatedAgent ? ["--security-opt", "seccomp=unconfined"] : []),
      "--network", authenticatedAgent ? providerNetwork! : "none",
      "--restart", "no", "--pids-limit", String(configuration.limits.processes),
      "--user", image.nonRootUser,
      "--mount", `type=volume,src=${inputVolume},dst=${INPUT_ROOT},readonly`,
      "--mount", `type=volume,src=${outputVolume},dst=${OUTPUT_ROOT}`,
      ...(providerStateVolume === null ? [] : ["--mount", `type=volume,src=${providerStateVolume},dst=${PROVIDER_STATE_ROOT}`]),
      "--tmpfs", `/tmp:rw,exec,nosuid,nodev,size=${Math.min(configuration.limits.storageBytes, 256 * 1024 * 1024)}`,
      ...(authenticatedAgent ? [
        "--env", `HTTP_PROXY=http://${PROVIDER_CONTROL_ALIAS}:${PROVIDER_CONTROL_PORT}`,
        "--env", `HTTPS_PROXY=http://${PROVIDER_CONTROL_ALIAS}:${PROVIDER_CONTROL_PORT}`,
        "--env", `http_proxy=http://${PROVIDER_CONTROL_ALIAS}:${PROVIDER_CONTROL_PORT}`,
        "--env", `https_proxy=http://${PROVIDER_CONTROL_ALIAS}:${PROVIDER_CONTROL_PORT}`,
      ] : []),
      "--entrypoint", RUNNER_ENTRYPOINT,
      image.immutableReference,
      "execute", "--specification", `${INPUT_ROOT}/${SPECIFICATION_PATH}`,
      "--input", INPUT_ROOT, "--output", OUTPUT_ROOT,
    ], { maximumStdoutBytes: 4096 });
  }

  async consumeDispatch(cellId: string): Promise<"consumed" | "already-consumed" | "ambiguous"> {
    const inspected = await this.#inspectContainer(cellId);
    if (inspected === null) return "ambiguous";
    const labels = object(object(inspected.Config, "Docker Cell configuration").Labels, "Docker Cell labels");
    const specificationDigest = privateLabel(labels, PRIVATE_LABELS.specificationDigest) as Sha256;
    if (!isSha256(specificationDigest)) fail("cell-integrity", "Docker Cell Specification digest is invalid");
    if (await this.#markerState("cancel", cellId, specificationDigest)) return "ambiguous";
    if (await this.#markerState("dispatch", cellId, specificationDigest)) return "already-consumed";
    const markerName = safeName(`lifecycle-dispatch-${cellId}`, "Docker dispatch marker");
    const markerLabels = volumeLabels("dispatch", { allocationName: cellId, specificationDigest, cellId });
    const result = await this.#command([
      "volume", "create", ...commandLabels(markerLabels), markerName,
    ], { allowFailure: true, maximumStdoutBytes: 4096 });
    const retained = await this.#volumeLabels(markerName);
    if (retained !== null && canonicalJson(retained) === canonicalJson(markerLabels)) return "consumed";
    return commandSucceeded(result) ? "ambiguous" : "ambiguous";
  }

  async startCell(cellId: string): Promise<void> {
    const inspected = await this.#inspectContainer(cellId);
    if (inspected === null) fail("start", "Docker Cell is absent at dispatch", true);
    const labels = object(object(inspected.Config, "Docker Cell configuration").Labels, "Docker Cell labels");
    const metadata = cellMetadata(labels, this.#options.images);
    const specificationDigest = privateLabel(labels, PRIVATE_LABELS.specificationDigest) as Sha256;
    if (!isSha256(specificationDigest) || !(await this.#markerState("dispatch", cellId, specificationDigest)) ||
        await this.#markerState("cancel", cellId, specificationDigest)) {
      fail("start", "Docker Cell lacks one exact consumed dispatch marker");
    }
    const state = object(inspected.State, "Docker Cell state");
    if (metadata.providerSupport !== null) {
      if (metadata.providerProxy === null || metadata.providerNetwork === null) {
        fail("provider-channel-integrity", "Agent Cell lacks its exact provider-control resources");
      }
      const providerLabels = Object.freeze({
        ...await this.#inheritedImageLabels(metadata.image),
        [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
        [PRIVATE_LABELS.resourceKind]: "provider-control",
        [PRIVATE_LABELS.allocationName]: metadata.allocationName,
        [PRIVATE_LABELS.specificationDigest]: specificationDigest,
      });
      const proxy = await this.#providerProxy(metadata.providerProxy, providerLabels);
      if (proxy === null) {
        fail("provider-channel-integrity", "Agent provider-control proxy is absent after dispatch");
      }
      const proxyHost = object(proxy.HostConfig, "Docker provider-control proxy host configuration");
      const proxyConfig = object(proxy.Config, "Docker provider-control proxy configuration");
      const proxyRestart = object(proxyHost.RestartPolicy, "Docker provider-control restart policy");
      const proxySecurity = Array.isArray(proxyHost.SecurityOpt) ? proxyHost.SecurityOpt : [];
      if (proxyHost.Privileged !== false || proxyHost.ReadonlyRootfs !== true ||
          proxyHost.NetworkMode !== "bridge" || proxyRestart.Name !== "no" ||
          !Array.isArray(proxyHost.CapDrop) || !proxyHost.CapDrop.includes("ALL") ||
          !proxySecurity.includes("no-new-privileges") ||
          proxyConfig.User !== metadata.image.nonRootUser ||
          canonicalJson(proxyConfig.Entrypoint) !== canonicalJson([RUNNER_ENTRYPOINT]) ||
          canonicalJson(proxyConfig.Cmd) !== canonicalJson([
            "provider-control-proxy",
            "--specification-digest", specificationDigest,
            "--policy-digest", metadata.configuration.networkPolicy.providerPolicyDigest,
            "--wall-time-milliseconds",
            String(metadata.configuration.limits.wallTimeMilliseconds),
          ])) {
        fail("provider-channel-integrity", "Agent provider-control proxy is not hardened");
      }
      const proxyState = object(proxy.State, "Docker provider-control proxy state");
      if (proxyState.Running !== true) {
        if (proxyState.Status !== "created") {
          fail("provider-channel-integrity", "Agent provider-control proxy is not dispatchable");
        }
        const started = await this.#command(
          ["container", "start", metadata.providerProxy],
          { allowFailure: true, maximumStdoutBytes: 4096 },
        );
        if (!commandSucceeded(started)) {
          fail("provider-channel-unavailable", "Agent provider-control proxy could not start", true);
        }
      }
      let providerChannelReady = false;
      for (let attempt = 0; attempt < 100 && !providerChannelReady; attempt += 1) {
        const ready = await this.#command([
          "container", "exec", metadata.providerProxy,
          "/usr/bin/test", "-r", "/tmp/lifecycle-provider-control-ready",
        ], { allowFailure: true, maximumStdoutBytes: 1024 });
        providerChannelReady = commandSucceeded(ready);
        if (!providerChannelReady) {
          await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
        }
      }
      if (!providerChannelReady) {
        fail("provider-channel-unavailable", "Agent provider-control readiness was not proven", true);
      }
    }
    if (state.Running !== true) {
      if (state.Status !== "created") {
        fail("start", "Docker Cell terminated before provider readiness could be established");
      }
      const result = await this.#command(["container", "start", cellId], { allowFailure: true, maximumStdoutBytes: 4096 });
      if (!commandSucceeded(result)) {
        const after = await this.#inspectContainer(cellId);
        if (after === null || object(after.State, "Docker Cell state").Status === "created") {
          fail("start", "Docker Cell start is unavailable after dispatch consumption", true);
        }
      }
    }
    if (metadata.providerSupport !== null) {
      const active = await this.#command([
        "container", "exec", cellId,
        "/usr/bin/test", "-r", `${PROVIDER_STATE_ROOT}/home/auth.json`,
      ], { allowFailure: true, maximumStdoutBytes: 1024 });
      const staged = commandSucceeded(active)
        ? active
        : await this.#command([
            "container", "exec", cellId,
            "/usr/bin/test", "-r", "/tmp/.lifecycle-provider-support/support.json",
          ], { allowFailure: true, maximumStdoutBytes: 1024 });
      if (!commandSucceeded(active) && !commandSucceeded(staged)) {
        const frame = await agentProviderSupportFrame(
          metadata,
          await this.#credentialSubject(specificationDigest, metadata.allocationName),
          this.#options.agentProviderSupport,
        );
        if (frame === null) {
          fail("provider-support", "Authenticated Agent Cell lost its private provider support");
        }
        try {
          const delivered = await this.#command(
            [
              "container", "exec", "--interactive", "--user", metadata.image.nonRootUser,
              cellId, RUNNER_ENTRYPOINT, "provider-support-receive",
            ],
            { allowFailure: true, stdin: frame, timeoutMilliseconds: 120_000 },
          );
          if (!commandSucceeded(delivered)) {
            fail("provider-support", "Agent provider support could not reach Cell-private tmpfs", true);
          }
        } finally {
          frame.fill(0);
        }
      }
      let ready = false;
      for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
        const available = await this.#command([
          "container", "exec", cellId,
          "/usr/bin/test", "-r", `${PROVIDER_STATE_ROOT}/home/auth.json`,
        ], { allowFailure: true, maximumStdoutBytes: 1024 });
        if (commandSucceeded(available)) {
          ready = true;
          break;
        }
        const after = await this.#inspectContainer(cellId);
        if (after !== null && object(after.State, "Docker Cell state").Running !== true) {
          // A terminal runner either emitted a normalized refusal or left no
          // reusable dispatch route. Observation owns the exact result.
          ready = true;
          break;
        }
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      if (!ready) {
        fail("provider-support", "Agent provider support readiness was not proven after dispatch", true);
      }
    }
  }

  async cancelCell(cellId: string): Promise<void> {
    const inspected = await this.#inspectContainer(cellId);
    if (inspected === null) return;
    const config = object(inspected.Config, "Docker Cell configuration");
    const labels = object(config.Labels, "Docker Cell labels");
    const metadata = cellMetadata(labels, this.#options.images);
    const specificationDigest = privateLabel(labels, PRIVATE_LABELS.specificationDigest) as Sha256;
    if (!isSha256(specificationDigest)) fail("cell-integrity", "Docker Cell Specification digest is invalid");
    const state = object(inspected.State, "Docker Cell state");
    const status = text(state.Status, "Docker Cell process status");
    const alreadyTerminal = state.Running !== true && (status === "exited" || status === "dead");
    if (!alreadyTerminal) {
      const markerName = safeName(`lifecycle-cancel-${cellId}`, "Docker cancellation marker");
      await this.#ensureVolume(
        markerName,
        volumeLabels("cancel", { allocationName: cellId, specificationDigest, cellId }),
      );
    }
    if (state.Running === true) {
      await this.#command(["container", "stop", "--time", "10", cellId], { allowFailure: true, maximumStdoutBytes: 4096 });
      const after = await this.#inspectContainer(cellId);
      if (after !== null && object(after.State, "Docker Cell state").Running === true) {
        await this.#command(["container", "kill", cellId], { allowFailure: true, maximumStdoutBytes: 4096 });
      }
    }
    if (metadata.providerProxy !== null) {
      const providerLabels = Object.freeze({
        ...await this.#inheritedImageLabels(metadata.image),
        [PRIVATE_LABELS.schema]: DRIVER_SCHEMA,
        [PRIVATE_LABELS.resourceKind]: "provider-control",
        [PRIVATE_LABELS.allocationName]: metadata.allocationName,
        [PRIVATE_LABELS.specificationDigest]: specificationDigest,
      });
      const proxy = await this.#providerProxy(metadata.providerProxy, providerLabels);
      if (proxy !== null && object(proxy.State, "Docker provider-control proxy state").Running === true) {
        const stopped = await this.#command(
          ["container", "stop", "--time", "5", metadata.providerProxy],
          { allowFailure: true, maximumStdoutBytes: 4096 },
        );
        if (!commandSucceeded(stopped)) {
          await this.#command(
            ["container", "kill", metadata.providerProxy],
            { allowFailure: true, maximumStdoutBytes: 4096 },
          );
        }
      }
    }
  }

  async retrieveOutput(input: Readonly<{
    cellId: string;
    specificationDigest: Sha256;
    inputSetDigest: Sha256;
    imageDigest: Sha256;
    outputContractDigest: Sha256;
    runnerContractDigest: Sha256;
    maximumEntries: number;
    maximumBytes: number;
    maximumEntryBytes: number;
  }>): Promise<FoundationDockerOutputRetrievalV1> {
    const archive = await this.#readOutputArchive(input.cellId, input.maximumBytes, input.maximumEntries);
    if (archive === null) {
      return Object.freeze({
        schema: "lifecycle.docker-output-retrieval.private.v1" as const,
        disposition: "unavailable" as const,
        unavailableReason: "missing" as const,
        output: null,
      });
    }
    let output: FoundationRetrievedExecutionOutputV1 | null;
    try {
      output = retrievedOutput(archive, input);
    } catch (error) {
      if (error instanceof FoundationError && error.code.startsWith("lifecycle.execution.docker-cli-driver.")) {
        return Object.freeze({
          schema: "lifecycle.docker-output-retrieval.private.v1" as const,
          disposition: "unavailable" as const,
          unavailableReason: "partial" as const,
          output: null,
        });
      }
      throw error;
    }
    if (output === null) {
      return Object.freeze({
        schema: "lifecycle.docker-output-retrieval.private.v1" as const,
        disposition: "unavailable" as const,
        unavailableReason: "missing" as const,
        output: null,
      });
    }
    return Object.freeze({
      schema: "lifecycle.docker-output-retrieval.private.v1" as const,
      disposition: "complete" as const,
      unavailableReason: null,
      output,
    });
  }

  async #removeVolume(name: string): Promise<"removed" | "missing" | "remaining" | "integrity-refusal"> {
    const labels = await this.#volumeLabels(name);
    if (labels === null) return "missing";
    if (labels[PRIVATE_LABELS.schema] !== DRIVER_SCHEMA) return "integrity-refusal";
    const result = await this.#command(["volume", "rm", name], { allowFailure: true, maximumStdoutBytes: 4096 });
    if (commandSucceeded(result) && await this.#volumeLabels(name) === null) return "removed";
    return "remaining";
  }

  async #ensureReclamationAnchor(input: Readonly<{
    inspection: FoundationDockerCellInspectionV1;
    inputVolume: string;
    outputVolume: string;
    providerStateVolume: string | null;
    specificationDigest: Sha256;
    providerNetwork: string | null;
    providerProxy: string | null;
  }>): Promise<void> {
    const anchorName = this.#reclamationAnchorName(input.inspection.cellId);
    const existing = await this.#volumeLabels(anchorName);
    if (existing !== null) {
      if (existing[PRIVATE_LABELS.schema] !== DRIVER_SCHEMA ||
          existing[PRIVATE_LABELS.resourceKind] !== "reclamation" ||
          existing[PRIVATE_LABELS.cellId] !== input.inspection.cellId ||
          existing[PRIVATE_LABELS.inputVolume] !== input.inputVolume ||
          existing[PRIVATE_LABELS.outputVolume] !== input.outputVolume ||
          (existing[PRIVATE_LABELS.providerStateVolume] ?? null) !== input.providerStateVolume ||
          (input.providerNetwork !== null &&
            existing[PRIVATE_LABELS.providerNetwork] !== input.providerNetwork) ||
          (input.providerProxy !== null &&
            existing[PRIVATE_LABELS.providerProxy] !== input.providerProxy) ||
          existing[PRIVATE_LABELS.specificationDigest] !== input.specificationDigest) {
        fail("reclamation-anchor", "Docker Reclamation anchor identity is substituted");
      }
      const retained = decodedInspection(existing, input.inspection.cellId);
      if (canonicalJson(retained.labels) !== canonicalJson(input.inspection.labels) ||
          canonicalJson(retained.configuration) !== canonicalJson(input.inspection.configuration) ||
          (retained.direct.processState !== "terminal" &&
            retained.direct.processState !== "not-started")) {
        fail("reclamation-anchor", "Docker Reclamation anchor retained another Cell subject");
      }
      return;
    }
    const snapshot = encodedInspection(input.inspection);
    const labels = Object.freeze({
      ...input.inspection.labels,
      ...volumeLabels("reclamation", {
        allocationName: input.inspection.cellId,
        specificationDigest: input.specificationDigest,
        cellId: input.inspection.cellId,
      }),
      [PRIVATE_LABELS.inputVolume]: input.inputVolume,
      [PRIVATE_LABELS.outputVolume]: input.outputVolume,
      ...(input.providerStateVolume === null ? {} : { [PRIVATE_LABELS.providerStateVolume]: input.providerStateVolume }),
      ...(input.providerNetwork === null ? {} : {
        [PRIVATE_LABELS.providerNetwork]: input.providerNetwork,
        [PRIVATE_LABELS.providerProxy]: input.providerProxy!,
      }),
      [PRIVATE_LABELS.reclamationInspection]: snapshot.value,
      [PRIVATE_LABELS.reclamationInspectionDigest]: snapshot.digest,
    });
    await this.#ensureVolume(anchorName, labels);
  }

  async #removeUnanchoredAllocation(input: Readonly<{
    allocationName: string;
    specificationDigest: Sha256;
  }>): Promise<"removed" | "missing" | "remaining" | "integrity-refusal"> {
    const allocationName = safeName(input.allocationName, "Docker Reclamation allocation");
    let removed = false;
    // Complete the retained deterministic allocation recipe even if its Cell
    // disappeared before a Reclamation anchor could be written.
    for (const [suffix, kind] of [["input-stage", "input-stage"], ["provider-proxy", "provider-control"],
      ["provider-state-read", "provider-state-read"]] as const) {
      const name = `${allocationName}-${suffix}`;
      const listed = await this.#command(["container", "ls", "--all", "--no-trunc", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"], { maximumStdoutBytes: 4096 });
      const ids = Buffer.from(listed.stdout).toString("utf8").split(/\r?\n/u).filter(Boolean);
      if (ids.length > 1) return "integrity-refusal";
      if (ids.length === 0) continue;
      const container = await this.#inspectContainer(ids[0]!);
      if (container === null) return "remaining";
      const image = this.#options.images.find(value => value.configurationDigest === container.Image);
      if (image === undefined) return "integrity-refusal";
      const expected = Object.freeze({ ...await this.#inheritedImageLabels(image),
        [PRIVATE_LABELS.schema]: DRIVER_SCHEMA, [PRIVATE_LABELS.resourceKind]: kind,
        [PRIVATE_LABELS.allocationName]: allocationName, [PRIVATE_LABELS.specificationDigest]: input.specificationDigest,
        ...(kind === "input-stage" ? { [PRIVATE_LABELS.inputVolume]: `${allocationName}-input` } : {}),
      });
      if (canonicalJson(object(container.Config, "Orphan allocation configuration").Labels) !== canonicalJson(expected)) return "integrity-refusal";
      if (object(container.State, "Orphan allocation state").Running === true && kind !== "provider-state-read") return "remaining";
      await this.#removeContainerByName(name, expected);
      removed = true;
    }
    const networkName = `${allocationName}-provider-net`;
    const network = await this.#network(networkName);
    if (network !== null) {
      const expected = { [PRIVATE_LABELS.schema]: DRIVER_SCHEMA, [PRIVATE_LABELS.resourceKind]: "provider-network",
        [PRIVATE_LABELS.allocationName]: allocationName, [PRIVATE_LABELS.specificationDigest]: input.specificationDigest };
      if (network.Internal !== true || canonicalJson(network.Labels) !== canonicalJson(expected)) return "integrity-refusal";
      if (Object.keys(object(network.Containers ?? {}, "Orphan network membership")).length !== 0) return "remaining";
      const result = await this.#command(["network", "rm", networkName], { allowFailure: true, maximumStdoutBytes: 4096 });
      if (!commandSucceeded(result) || await this.#network(networkName) !== null) return "remaining";
      removed = true;
    }
    for (const kind of ["input", "output", "provider-state"] as const) {
      const name = `${allocationName}-${kind}`;
      const expected = volumeLabels(kind, { allocationName, specificationDigest: input.specificationDigest });
      const matching = await this.#volumeNamesByLabels(expected, 2);
      const labels = await this.#volumeLabels(name);
      if (matching.some(value => value !== name) || matching.length > 1 ||
          (labels !== null && canonicalJson(labels) !== canonicalJson(expected))) return "integrity-refusal";
      if (labels === null) continue;
      const result = await this.#removeVolume(name);
      if (result === "remaining" || result === "integrity-refusal") return result;
      removed = true;
    }
    return removed ? "removed" : "missing";
  }

  async removeCell(input: Readonly<{
    cellId: string;
    specificationDigest: Sha256;
    allocationName?: string;
  }>): Promise<"removed" | "missing" | "remaining" | "integrity-refusal"> {
    const cellId = input.cellId;
    if (!/^[a-f0-9]{64}$/u.test(cellId) || !isSha256(input.specificationDigest)) {
      return "integrity-refusal";
    }
    const container = await this.#inspectContainer(cellId);
    const anchorName = this.#reclamationAnchorName(cellId);
    const anchorLabels = await this.#volumeLabels(anchorName);
    if (container === null && anchorLabels === null) {
      const allocation = input.allocationName === undefined ? "missing" : await this.#removeUnanchoredAllocation({
        allocationName: input.allocationName, specificationDigest: input.specificationDigest,
      });
      if (allocation === "remaining" || allocation === "integrity-refusal") return allocation;
      const dispatch = await this.#removeExactMarker(
        "dispatch",
        cellId,
        input.specificationDigest,
      );
      const cancel = await this.#removeExactMarker(
        "cancel",
        cellId,
        input.specificationDigest,
      );
      if (dispatch === "integrity-refusal" || cancel === "integrity-refusal") {
        return "integrity-refusal";
      }
      if (dispatch === "remaining" || cancel === "remaining") return "remaining";
      if (input.allocationName !== undefined && !await this.allocationResourcesAbsent({
        allocationName: input.allocationName, specificationDigest: input.specificationDigest,
      })) return "remaining";
      return allocation === "removed" || dispatch === "removed" || cancel === "removed" ? "removed" : "missing";
    }
    let inputVolume: string;
    let outputVolume: string;
    let providerStateVolume: string | null;
    let specificationDigest: Sha256;
    let providerNetwork: string | null;
    let providerProxy: string | null;
    if (container !== null) {
      const state = object(container.State, "Docker Cell state");
      if (state.Running === true) return "integrity-refusal";
      const labels = object(object(container.Config, "Docker Cell configuration").Labels, "Docker Cell labels");
      const metadata = cellMetadata(labels, this.#options.images);
      inputVolume = metadata.inputVolume;
      outputVolume = metadata.outputVolume;
      providerStateVolume = metadata.providerStateVolume;
      specificationDigest = privateLabel(labels, PRIVATE_LABELS.specificationDigest) as Sha256;
      providerNetwork = metadata.providerNetwork;
      providerProxy = metadata.providerProxy;
      if (!isSha256(specificationDigest) || specificationDigest !== input.specificationDigest) {
        return "integrity-refusal";
      }
      const inspection = await this.inspectCell(cellId);
      if (inspection === null ||
          (inspection.direct.processState !== "terminal" &&
            inspection.direct.processState !== "not-started")) return "integrity-refusal";
      await this.#ensureReclamationAnchor({
        inspection,
        inputVolume,
        outputVolume,
        providerStateVolume,
        specificationDigest,
        providerNetwork,
        providerProxy,
      });
      const removed = await this.#command(
        ["container", "rm", cellId],
        { allowFailure: true, maximumStdoutBytes: 4096 },
      );
      if (!commandSucceeded(removed) && await this.#inspectContainer(cellId) !== null) return "remaining";
    } else {
      if (anchorLabels![PRIVATE_LABELS.schema] !== DRIVER_SCHEMA ||
          anchorLabels![PRIVATE_LABELS.resourceKind] !== "reclamation" ||
          anchorLabels![PRIVATE_LABELS.cellId] !== cellId) return "integrity-refusal";
      decodedInspection(anchorLabels!, cellId);
      inputVolume = safeName(privateLabel(anchorLabels!, PRIVATE_LABELS.inputVolume), "Docker input volume");
      outputVolume = safeName(privateLabel(anchorLabels!, PRIVATE_LABELS.outputVolume), "Docker output volume");
      providerStateVolume = typeof anchorLabels![PRIVATE_LABELS.providerStateVolume] === "string"
        ? safeName(privateLabel(anchorLabels!, PRIVATE_LABELS.providerStateVolume), "Docker provider-state volume") : null;
      specificationDigest = privateLabel(anchorLabels!, PRIVATE_LABELS.specificationDigest) as Sha256;
      providerNetwork = typeof anchorLabels![PRIVATE_LABELS.providerNetwork] === "string"
        ? safeName(
            privateLabel(anchorLabels!, PRIVATE_LABELS.providerNetwork),
            "Provider-control network",
          )
        : null;
      providerProxy = typeof anchorLabels![PRIVATE_LABELS.providerProxy] === "string"
        ? safeName(
            privateLabel(anchorLabels!, PRIVATE_LABELS.providerProxy),
            "Provider-control proxy",
          )
        : null;
      if ((providerNetwork === null) !== (providerProxy === null) ||
          (providerNetwork === null) !== (providerStateVolume === null)) return "integrity-refusal";
      if (!isSha256(specificationDigest) || specificationDigest !== input.specificationDigest) {
        return "integrity-refusal";
      }
    }
    if (providerProxy !== null) {
      const proxy = await this.#command([
        "container", "ls", "--all", "--no-trunc", "--filter",
        `name=^/${providerProxy}$`, "--format", "{{.ID}}",
      ], { maximumStdoutBytes: 4096 });
      const proxyIds = Buffer.from(proxy.stdout).toString("utf8").split(/\r?\n/u).filter(Boolean);
      if (proxyIds.length > 1) return "integrity-refusal";
      if (proxyIds.length === 1) {
        const removedProxy = await this.#command(
          ["container", "rm", providerProxy],
          { allowFailure: true, maximumStdoutBytes: 4096 },
        );
        if (!commandSucceeded(removedProxy)) return "remaining";
      }
    }
    if (providerNetwork !== null) {
      const network = await this.#network(providerNetwork);
      if (network !== null) {
        const networkLabels = object(network.Labels, "Docker provider-control network labels");
        if (network.Internal !== true || networkLabels[PRIVATE_LABELS.schema] !== DRIVER_SCHEMA ||
            networkLabels[PRIVATE_LABELS.resourceKind] !== "provider-network" ||
            networkLabels[PRIVATE_LABELS.specificationDigest] !== specificationDigest) {
          return "integrity-refusal";
        }
        const removedNetwork = await this.#command(
          ["network", "rm", providerNetwork],
          { allowFailure: true, maximumStdoutBytes: 4096 },
        );
        if (!commandSucceeded(removedNetwork) || await this.#network(providerNetwork) !== null) {
          return "remaining";
        }
      }
    }
    if (providerStateVolume !== null) {
      const allocationName = providerStateVolume.slice(0, -"-provider-state".length);
      if (providerStateVolume !== `${allocationName}-provider-state`) return "integrity-refusal";
      const stateLabels = await this.#volumeLabels(providerStateVolume);
      if (stateLabels !== null && canonicalJson(stateLabels) !== canonicalJson(volumeLabels("provider-state", { allocationName, specificationDigest }))) {
        return "integrity-refusal";
      }
      const anchor = await this.#volumeLabels(anchorName);
      if (anchor === null) return "integrity-refusal";
      const retained = decodedInspection(anchor, cellId);
      const image = this.#image(retained.configuration.image.imageId, retained.configuration.image.imageDigest);
      await this.#removeContainerByName(`${allocationName}-provider-state-read`, Object.freeze({
        ...await this.#inheritedImageLabels(image), ...this.#credentialReadLabels(allocationName, specificationDigest),
      }));
    }
    const resources = [inputVolume, outputVolume, ...(providerStateVolume === null ? [] : [providerStateVolume])];
    let remaining = false;
    for (const name of resources) {
      const disposition = await this.#removeVolume(name);
      if (disposition === "integrity-refusal") return disposition;
      if (disposition === "remaining") remaining = true;
    }
    const dispatch = await this.#removeExactMarker(
      "dispatch",
      cellId,
      specificationDigest,
    );
    const cancel = await this.#removeExactMarker(
      "cancel",
      cellId,
      specificationDigest,
    );
    if (dispatch === "integrity-refusal" || cancel === "integrity-refusal") {
      return "integrity-refusal";
    }
    if (dispatch === "remaining" || cancel === "remaining") remaining = true;
    if (remaining) return "remaining";
    const anchorDisposition = await this.#removeVolume(anchorName);
    if (anchorDisposition === "integrity-refusal") return anchorDisposition;
    return anchorDisposition === "remaining" ? "remaining" : "removed";
  }
}

async function createDriver(options: InternalOptions): Promise<FoundationDockerEngineDriverV1> {
  validateOptions(options);
  if (options.verifyExecutable) {
    await assertExactExecutable(options.dockerExecutable, options.dockerExecutableDigest);
    await assertPrivateDockerConfigurationDirectory(options.dockerConfigDirectory);
  }
  const driver = new DockerCliEngineDriver(options);
  await driver.describe();
  return driver;
}

/** Create the production CLI adapter. It never invokes a shell or ambient Docker context. */
export async function createFoundationDockerCliEngineDriverV1(
  options: FoundationDockerCliEngineDriverOptionsV1,
): Promise<FoundationDockerEngineDriverV1> {
  return await createDriver(Object.freeze({
    ...options,
    commandExecutor: new SpawnDockerCliCommandExecutor(),
    verifyExecutable: true,
  }));
}

/** Deterministic unit-test entry; this cannot be selected as an installed production fallback. */
export async function createFoundationDockerCliEngineDriverForTestingV1(
  options: FoundationDockerCliEngineDriverOptionsV1 & Readonly<{
    commandExecutor: FoundationDockerCliCommandExecutorV1;
  }>,
): Promise<FoundationDockerEngineDriverV1> {
  return await createDriver(Object.freeze({ ...options, verifyExecutable: false }));
}
