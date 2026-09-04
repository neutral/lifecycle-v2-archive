import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  open,
  readFile,
  realpath,
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  sep,
} from "node:path";
import { FoundationError } from "./error.js";
import type { FoundationDockerCliImageInstallationV1 } from "./execution/docker-cli-engine-driver-v1.js";
import { ensureFoundationInstallationIdentityV1 } from "./installation-identity-v1.js";
import { sha256Bytes, type Sha256 } from "./validation/canonical.js";
import {
  FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  FOUNDATION_GENERATED_SPECIFICATION_REVISION,
} from "./validation/generated-schemas.js";

const MAXIMUM_PATH_BYTES = 4_096;
const MAXIMUM_PROVIDER_SELECTION_CHARACTERS = 160;
const OPAQUE_SELECTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export const FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7 = Object.freeze({
  machineHome: "LIFECYCLE_MACHINE_HOME",
  model: "LIFECYCLE_FOUNDATION_PROVIDER_MODEL",
  reasoning: "LIFECYCLE_FOUNDATION_PROVIDER_REASONING",
  dockerPath: "LIFECYCLE_DOCKER_PATH",
  dockerHost: "LIFECYCLE_DOCKER_HOST",
  dockerConfig: "LIFECYCLE_DOCKER_CONFIG",
  executionImageId: "LIFECYCLE_EXECUTION_IMAGE_ID",
  executionImageDigest: "LIFECYCLE_EXECUTION_IMAGE_DIGEST",
  executionImageArchitecture: "LIFECYCLE_EXECUTION_IMAGE_ARCHITECTURE",
  executionRunnerContractDigest: "LIFECYCLE_EXECUTION_RUNNER_CONTRACT_DIGEST",
  executionRunnerImplementationDigest: "LIFECYCLE_EXECUTION_RUNNER_IMPLEMENTATION_DIGEST",
  executionToolInventoryDigest: "LIFECYCLE_EXECUTION_TOOL_INVENTORY_DIGEST",
  executionCodexVersion: "LIFECYCLE_EXECUTION_CODEX_VERSION",
  executionCodexExecutableIdentity: "LIFECYCLE_EXECUTION_CODEX_EXECUTABLE_IDENTITY",
  executionAgentAdapterImplementationDigest:
    "LIFECYCLE_EXECUTION_AGENT_ADAPTER_IMPLEMENTATION_DIGEST",
} as const);

export const FOUNDATION_RETIRED_CONFIGURATION_ENVIRONMENT_V7 = Object.freeze([
  "LIFECYCLE_CODEX_PATH",
  "LIFECYCLE_FOUNDATION_PROVIDER_HOME",
  "LIFECYCLE_FOUNDATION_PROVIDER_CODEX_PATH",
] as const);

export type FoundationInstalledRuntimeConfigurationV7 = Readonly<{
  machineHome: string;
  installationId: string;
  codexHome: string;
  model: string;
  reasoning: string;
  specificationRevision: typeof FOUNDATION_GENERATED_SPECIFICATION_REVISION;
  publicationDigest: Sha256;
  /** Present only when the installed Docker Execution Backend is selected. */
  execution?: FoundationInstalledExecutionConfigurationV1;
}>;

export type FoundationInstalledExecutionConfigurationV1 = Readonly<{
  dockerExecutable: string;
  dockerExecutableDigest: Sha256;
  engineEndpoint: string;
  dockerConfigDirectory: string;
  image: FoundationDockerCliImageInstallationV1;
}>;

export type FoundationInstalledMachineCustodyV7 = Readonly<{
  machineHome: string;
}>;

export type FoundationInstalledRepositoryInitializationV7 = Readonly<{
  machineHome: string;
  installationId: string;
  publicationDigest: Sha256;
}>;

export type ResolveFoundationInstalledRuntimeConfigurationV7Options = Readonly<{
  environment?: NodeJS.ProcessEnv;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.installed-configuration-v7.${code}`, message);
}

function environmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (
    value === undefined || value.length === 0 || value.includes("\0") ||
    /[\r\n]/u.test(value)
  ) {
    fail("environment", `Installed environment ${name} is unavailable or invalid`);
  }
  return value;
}

function exactAbsolutePath(value: string, label: string): string {
  if (
    Buffer.byteLength(value, "utf8") > MAXIMUM_PATH_BYTES ||
    !isAbsolute(value) || normalize(value) !== value || value === parse(value).root ||
    value.endsWith(sep) || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail("path", `${label} must be one bounded normalized absolute non-root path`);
  }
  return value;
}

function effectiveUid(): bigint | null {
  const value = process.geteuid?.() ?? process.getuid?.();
  return value === undefined ? null : BigInt(value);
}

async function exactOwnedDirectory(value: string, label: string): Promise<string> {
  const path = exactAbsolutePath(value, label);
  let state;
  let physical: string;
  try {
    [state, physical] = await Promise.all([
      lstat(path, { bigint: true }),
      realpath(path),
      access(path, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK),
    ]);
  } catch {
    fail("directory", `${label} is unavailable to the effective runtime user`);
  }
  if (!state.isDirectory() || state.isSymbolicLink() || physical !== path) {
    fail("directory", `${label} must be one canonical physical directory`);
  }
  const uid = effectiveUid();
  if (uid !== null && state.uid !== uid) {
    fail("directory-owner", `${label} must be owned by the effective runtime user`);
  }
  return physical;
}

async function exactExecutable(
  value: string,
  label: string,
  code: string,
): Promise<string> {
  const path = exactAbsolutePath(value, label);
  let pathState;
  let physical: string;
  try {
    [pathState, physical] = await Promise.all([
      lstat(path, { bigint: true }),
      realpath(path),
      access(path, fsConstants.X_OK),
    ]);
  } catch {
    fail(code, `${label} is unavailable or not executable`);
  }
  if (!pathState.isFile() || pathState.isSymbolicLink() || physical !== path) {
    fail(
      code,
      `${label} must be one canonical regular executable file`,
    );
  }

  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() || opened.dev !== pathState.dev || opened.ino !== pathState.ino ||
      opened.size !== pathState.size || opened.mtimeNs !== pathState.mtimeNs ||
      opened.ctimeNs !== pathState.ctimeNs
    ) {
      fail(`${code}-drift`, `${label} changed while resolved`);
    }
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    fail(code, `${label} cannot be pinned as one regular file`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return physical;
}

function providerSelection(value: string, label: string): string {
  if (
    value.length > MAXIMUM_PROVIDER_SELECTION_CHARACTERS ||
    !OPAQUE_SELECTION_PATTERN.test(value)
  ) {
    fail(
      "provider-selection",
      `${label} must be one bounded opaque provider identity of at most ${MAXIMUM_PROVIDER_SELECTION_CHARACTERS} characters`,
    );
  }
  return value;
}

function installedDigest(value: string, label: string): Sha256 {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    fail("execution-digest", `${label} must be one lowercase SHA-256 digest`);
  }
  return value as Sha256;
}

async function resolveInstalledExecutionConfiguration(
  environment: NodeJS.ProcessEnv,
): Promise<FoundationInstalledExecutionConfigurationV1 | undefined> {
  const names = [
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerPath,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerHost,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerConfig,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageId,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageDigest,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageArchitecture,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionRunnerContractDigest,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionRunnerImplementationDigest,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionToolInventoryDigest,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionCodexVersion,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionCodexExecutableIdentity,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionAgentAdapterImplementationDigest,
  ] as const;
  if (names.every((name) => environment[name] === undefined)) return undefined;
  const dockerExecutable = await exactExecutable(
    environmentValue(
      environment,
      FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerPath,
    ),
    "Docker CLI executable",
    "docker-executable",
  );
  const dockerBytes = await readFile(dockerExecutable);
  const engineEndpoint = environmentValue(
    environment,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerHost,
  );
  if (!/^unix:\/\/\/[^\0\r\n]+$/u.test(engineEndpoint)) {
    fail("execution-endpoint", "Installed Docker endpoint must be one explicit local Unix endpoint");
  }
  const dockerConfigDirectory = await exactOwnedDirectory(environmentValue(
    environment,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerConfig,
  ), "Private Docker configuration directory");
  const architecture = environmentValue(
    environment,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageArchitecture,
  );
  if (architecture !== "amd64" && architecture !== "arm64") {
    fail("execution-image", "Installed Execution Image architecture must be amd64 or arm64");
  }
  const imageDigest = installedDigest(environmentValue(
    environment,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageDigest,
  ), "Installed Execution Image digest");
  const agentNames = [
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionCodexVersion,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionCodexExecutableIdentity,
    FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionAgentAdapterImplementationDigest,
  ] as const;
  const selectedAgentNames = agentNames.filter((name) => environment[name] !== undefined);
  if (selectedAgentNames.length !== 0 && selectedAgentNames.length !== agentNames.length) {
    fail("execution-agent-image", "Installed Agent Execution Image selection is incomplete");
  }
  const agentProvider = selectedAgentNames.length === 0
    ? undefined
    : Object.freeze({
        codexVersion: environmentValue(
          environment,
          FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionCodexVersion,
        ),
        executableIdentity: installedDigest(environmentValue(
          environment,
          FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionCodexExecutableIdentity,
        ), "Installed Execution Image Codex identity"),
        adapterImplementationDigest: installedDigest(environmentValue(
          environment,
          FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7
            .executionAgentAdapterImplementationDigest,
        ), "Installed Execution Image Agent Adapter digest"),
      });
  if (agentProvider !== undefined && !/^\d+\.\d+\.\d+$/u.test(agentProvider.codexVersion)) {
    fail("execution-agent-image", "Installed Execution Image Codex version is invalid");
  }
  return Object.freeze({
    dockerExecutable,
    dockerExecutableDigest: sha256Bytes(dockerBytes),
    engineEndpoint,
    dockerConfigDirectory,
    image: Object.freeze({
      imageId: providerSelection(environmentValue(
        environment,
        FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageId,
      ), "Installed Execution Image identity"),
      imageDigest,
      immutableReference: imageDigest,
      configurationDigest: imageDigest,
      platform: Object.freeze({ os: "linux" as const, architecture, variant: null }),
      nonRootUser: "65532:65532",
      runnerContractId: "lifecycle.execution-cell-runner.v1" as const,
      runnerContractDigest: installedDigest(environmentValue(
        environment,
        FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionRunnerContractDigest,
      ), "Installed Cell runner contract digest"),
      runnerImplementationDigest: installedDigest(environmentValue(
        environment,
        FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionRunnerImplementationDigest,
      ), "Installed Cell runner implementation digest"),
      toolInventoryDigest: installedDigest(environmentValue(
        environment,
        FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionToolInventoryDigest,
      ), "Installed Execution Image tool inventory digest"),
      ...(agentProvider === undefined ? {} : { agentProvider }),
    }),
  });
}

function within(parent: string, child: string): boolean {
  const displacement = relative(parent, child);
  return displacement === "" || (
    displacement !== ".." && !displacement.startsWith(`..${sep}`) &&
    !isAbsolute(displacement)
  );
}

/**
 * Resolve only the runtime-owned machine custody required to locate one
 * Delivery Control Record Store. This deliberately does not inspect provider
 * selection or Execution Backend configuration.
 */
export async function resolveFoundationInstalledMachineCustodyV7(
  options: ResolveFoundationInstalledRuntimeConfigurationV7Options = {},
): Promise<FoundationInstalledMachineCustodyV7> {
  const environment = options.environment ?? process.env;
  return Object.freeze({
    machineHome: await exactOwnedDirectory(
      environmentValue(environment, FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.machineHome),
      "Lifecycle machine home",
    ),
  });
}

/** Resolve machine custody, its private durable identity, and the embedded publication used by setup. */
export async function resolveFoundationInstalledRepositoryInitializationV7(
  options: ResolveFoundationInstalledRuntimeConfigurationV7Options = {},
): Promise<FoundationInstalledRepositoryInitializationV7> {
  const { machineHome } = await resolveFoundationInstalledMachineCustodyV7(options);
  const { installationId } = await ensureFoundationInstallationIdentityV1(machineHome);
  return Object.freeze({
    machineHome,
    installationId,
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST as Sha256,
  });
}

/**
 * Resolve the complete installed v7 machine/provider configuration without
 * consulting a target or accepting any of these values through a public
 * operation request.
 */
export async function resolveFoundationInstalledRuntimeConfigurationV7(
  options: ResolveFoundationInstalledRuntimeConfigurationV7Options = {},
): Promise<FoundationInstalledRuntimeConfigurationV7> {
  const environment = options.environment ?? process.env;
  for (const name of FOUNDATION_RETIRED_CONFIGURATION_ENVIRONMENT_V7) {
    if (Object.hasOwn(environment, name) && environment[name] !== undefined) {
      fail("retired-environment", `Retired installed environment ${name} is not accepted`);
    }
  }

  const { machineHome } = await resolveFoundationInstalledMachineCustodyV7({ environment });
  const codexHome = await exactOwnedDirectory(
    join(machineHome, "codex-exec-home"),
    "Isolated Codex home",
  );
  if (!within(machineHome, codexHome) || codexHome === machineHome) {
    fail("codex-home", "The isolated Codex home must be the exact child of the machine home");
  }
  const model = providerSelection(
    environmentValue(environment, FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.model),
    "Installed provider model",
  );
  const reasoning = providerSelection(
    environmentValue(environment, FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.reasoning),
    "Installed provider reasoning",
  );
  const execution = await resolveInstalledExecutionConfiguration(environment);
  const { installationId } = await ensureFoundationInstallationIdentityV1(machineHome);

  return Object.freeze({
    machineHome,
    installationId,
    codexHome,
    model,
    reasoning,
    specificationRevision: FOUNDATION_GENERATED_SPECIFICATION_REVISION,
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST as Sha256,
    ...(execution === undefined ? {} : { execution }),
  });
}
