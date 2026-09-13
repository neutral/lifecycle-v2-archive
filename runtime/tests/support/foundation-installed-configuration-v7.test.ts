import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import {
  FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7,
  resolveFoundationInstalledMachineCustodyV7,
  resolveFoundationInstalledReadInvestmentV7,
  resolveFoundationInstalledRepositoryInitializationV7,
  resolveFoundationInstalledRuntimeConfigurationV7,
  selectFoundationProcessRuntimeConfigurationV7,
} from "../../src/foundation/installed-configuration-v7.js";
import {
  FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  FOUNDATION_GENERATED_SPECIFICATION_REVISION,
} from "../../src/foundation/validation/generated-schemas.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";

async function fixture(): Promise<Readonly<{
  root: string;
  machineHome: string;
  codexHome: string;
  executablePath: string;
  dockerConfig: string;
  environment: NodeJS.ProcessEnv;
}>> {
  const root = await realpath(await mkdtemp(
    join(tmpdir(), "lifecycle-installed-configuration-v7-"),
  ));
  const machineHome = join(root, "machine-home");
  const codexHome = join(machineHome, "codex-exec-home");
  const executablePath = join(root, "docker");
  const dockerConfig = join(root, "docker-config");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await mkdir(dockerConfig, { mode: 0o700 });
  await writeFile(executablePath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await chmod(executablePath, 0o700);
  return Object.freeze({
    root,
    machineHome,
    codexHome,
    executablePath,
    dockerConfig,
    environment: {
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.machineHome]: machineHome,
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.model]: "gpt-5.6-sol",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.reasoning]: "high",
      CODEX_HOME: join(root, "ambient-codex-home-must-be-ignored"),
    },
  });
}

function configurationCode(suffix: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert(error instanceof FoundationError);
    assert.equal(error.code, `lifecycle.installed-configuration-v7.${suffix}`);
    return true;
  };
}

test("v7 resolves one immutable installed configuration without an optional Execution Backend", async () => {
  const value = await fixture();
  try {
    const configuration = await resolveFoundationInstalledRuntimeConfigurationV7({
      environment: value.environment,
    });
    assert.match(configuration.installationId, /^installation\.lifecycle\.[a-f0-9]{64}$/u);
    assert.deepEqual(configuration, {
      machineHome: value.machineHome,
      installationId: configuration.installationId,
      codexHome: value.codexHome,
      model: "gpt-5.6-sol",
      reasoning: "high",
      specificationRevision: FOUNDATION_GENERATED_SPECIFICATION_REVISION,
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    });
    assert(Object.isFrozen(configuration));
    assert.deepEqual(resolveFoundationInstalledReadInvestmentV7({ environment: value.environment }), {
      model: configuration.model,
      reasoning: configuration.reasoning,
    });
    const processConfiguration = selectFoundationProcessRuntimeConfigurationV7(configuration);
    assert.equal("codexHome" in processConfiguration, false);
    assert.equal("execution" in processConfiguration, false);
    assert.equal(processConfiguration.machineHome, configuration.machineHome);
    assert.equal(processConfiguration.model, configuration.model);
    assert.equal(processConfiguration.reasoning, configuration.reasoning);
    assert.notEqual(configuration.codexHome, value.environment.CODEX_HOME);
    const reopened = await resolveFoundationInstalledRuntimeConfigurationV7({
      environment: value.environment,
    });
    assert.equal(reopened.installationId, configuration.installationId);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("v7 resolves machine custody without consulting provider or retired configuration", async () => {
  const value = await fixture();
  try {
    const custody = await resolveFoundationInstalledMachineCustodyV7({
      environment: {
        LIFECYCLE_MACHINE_HOME: value.machineHome,
        LIFECYCLE_CODEX_PATH: "not-an-absolute-path",
        LIFECYCLE_FOUNDATION_PROVIDER_MODEL: "invalid provider selection",
        LIFECYCLE_FOUNDATION_PROVIDER_REASONING: "high\nmax",
        LIFECYCLE_FOUNDATION_PROVIDER_HOME: "/retired/provider/home",
      },
    });
    assert.deepEqual(custody, { machineHome: value.machineHome });
    assert(Object.isFrozen(custody));
    const initialization = await resolveFoundationInstalledRepositoryInitializationV7({
      environment: {
        LIFECYCLE_MACHINE_HOME: value.machineHome,
        LIFECYCLE_CODEX_PATH: "not-an-absolute-path",
        LIFECYCLE_FOUNDATION_PROVIDER_HOME: "/retired/provider/home",
      },
    });
    assert.equal(initialization.machineHome, value.machineHome);
    assert.match(initialization.installationId, /^installation\.lifecycle\.[a-f0-9]{64}$/u);
    assert.match(initialization.publicationDigest, /^sha256:[a-f0-9]{64}$/u);
    assert(Object.isFrozen(initialization));
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("read Investment observes only exact configured model and reasoning without execution custody", () => {
  const names = FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7;
  const selected: NodeJS.ProcessEnv = {
    [names.model]: "gpt-5.6-sol",
    [names.reasoning]: "high",
  };
  const accessed: string[] = [];
  const environment = new Proxy(selected, {
    get(target, key) {
      assert.equal(typeof key, "string");
      assert.ok(key === names.model || key === names.reasoning,
        "read preview must not consult machine paths, provider homes, Docker, images or retired settings");
      accessed.push(key);
      return target[key];
    },
    ownKeys() { throw new Error("read preview must not enumerate ambient environment"); },
  });
  const result = resolveFoundationInstalledReadInvestmentV7({ environment });
  assert.deepEqual(result, { model: "gpt-5.6-sol", reasoning: "high" });
  assert.deepEqual(accessed, [names.model, names.reasoning]);
  assert(Object.isFrozen(result));
});

test("unavailable read Investment never fabricates or partially returns configured choices", () => {
  const names = FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7;
  const selected = { [names.model]: "gpt-5.6-sol", [names.reasoning]: "high" };
  for (const name of [names.model, names.reasoning]) {
    for (const value of [undefined, "", " model", "model name", "high\n", "high\r", "high\0", "high\u2028", "x".repeat(161)]) {
      assert.equal(resolveFoundationInstalledReadInvestmentV7({
        environment: { ...selected, [name]: value },
      }), null);
    }
    const exactBound = "x".repeat(160);
    assert.deepEqual(resolveFoundationInstalledReadInvestmentV7({
      environment: { ...selected, [name]: exactBound },
    }), {
      model: name === names.model ? exactBound : selected[names.model],
      reasoning: name === names.reasoning ? exactBound : selected[names.reasoning],
    });
  }
  assert.equal(resolveFoundationInstalledReadInvestmentV7({ environment: {} }), null);
  const unavailable = new Error("environment observation unavailable");
  assert.throws(() => resolveFoundationInstalledReadInvestmentV7({
    environment: new Proxy({}, { get() { throw unavailable; } }),
  }), error => error === unavailable, "unknown observation errors remain errors");
});

test("v7 refuses missing, malformed, and retired installed environment", async () => {
  const value = await fixture();
  try {
    for (const name of [
      FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.machineHome,
      FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.model,
      FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.reasoning,
    ]) {
      const environment = { ...value.environment };
      delete environment[name];
      await assert.rejects(
        resolveFoundationInstalledRuntimeConfigurationV7({ environment }),
        configurationCode("environment"),
      );
    }

    await assert.rejects(resolveFoundationInstalledRuntimeConfigurationV7({
      environment: {
        ...value.environment,
        LIFECYCLE_FOUNDATION_PROVIDER_HOME: "",
      },
    }), configurationCode("retired-environment"));
    await assert.rejects(resolveFoundationInstalledRuntimeConfigurationV7({
      environment: {
        ...value.environment,
        LIFECYCLE_FOUNDATION_PROVIDER_CODEX_PATH: value.executablePath,
      },
    }), configurationCode("retired-environment"));
    await assert.rejects(resolveFoundationInstalledRuntimeConfigurationV7({
      environment: {
        ...value.environment,
        LIFECYCLE_CODEX_PATH: value.executablePath,
      },
    }), configurationCode("retired-environment"));

    for (const [name, selected] of [
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.model, " model"],
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.reasoning, "high\nmax"],
    ] as const) {
      await assert.rejects(resolveFoundationInstalledRuntimeConfigurationV7({
        environment: { ...value.environment, [name]: selected },
      }), configurationCode(name.endsWith("REASONING") ? "environment" : "provider-selection"));
    }
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("v7 resolves the complete installed Docker execution selection and refuses partial selection", async () => {
  const value = await fixture();
  try {
    const executionValues = Object.freeze({
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerPath]: value.executablePath,
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerHost]: "unix:///private/test-docker.sock",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerConfig]: value.dockerConfig,
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageId]: "execution-image.test.v1",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageDigest]:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageArchitecture]: "arm64",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionRunnerContractDigest]:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionRunnerImplementationDigest]:
        "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionToolInventoryDigest]:
        "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    });
    const environment = { ...value.environment, ...executionValues };
    const configuration = await resolveFoundationInstalledRuntimeConfigurationV7({ environment });
    assert.notEqual(configuration.execution, undefined);
    assert.equal(configuration.execution!.dockerExecutable, value.executablePath);
    assert.equal(configuration.execution!.dockerExecutableDigest,
      sha256Bytes(await readFile(value.executablePath)));
    assert.equal(configuration.execution!.engineEndpoint, "unix:///private/test-docker.sock");
    assert.equal(configuration.execution!.image.imageDigest,
      executionValues.LIFECYCLE_EXECUTION_IMAGE_DIGEST);
    assert.equal(configuration.execution!.image.immutableReference,
      executionValues.LIFECYCLE_EXECUTION_IMAGE_DIGEST);
    assert.equal(configuration.execution!.image.configurationDigest,
      executionValues.LIFECYCLE_EXECUTION_IMAGE_DIGEST);
    assert.equal(configuration.execution!.image.nonRootUser, "65532:65532");
    const processConfiguration = selectFoundationProcessRuntimeConfigurationV7(configuration);
    assert.deepEqual(Object.keys(processConfiguration).sort(), [
      "execution", "installationId", "machineHome", "model", "publicationDigest",
      "reasoning", "specificationRevision",
    ]);
    assert.deepEqual(Object.keys(processConfiguration.execution!), ["image"]);
    assert.deepEqual(Object.keys(processConfiguration.execution!.image).sort(), [
      "configurationDigest", "imageDigest", "imageId", "immutableReference", "nonRootUser", "platform", "runnerContractDigest", "runnerContractId",
      "runnerImplementationDigest", "toolInventoryDigest",
    ]);
    assert.equal(processConfiguration.execution!.image.imageDigest, configuration.execution!.image.imageDigest);
    assert(Object.isFrozen(processConfiguration));
    assert(Object.isFrozen(processConfiguration.execution));
    assert(Object.isFrozen(processConfiguration.execution!.image));

    for (const name of Object.keys(executionValues)) {
      const partial: NodeJS.ProcessEnv = { ...environment };
      delete partial[name];
      await assert.rejects(
        resolveFoundationInstalledRuntimeConfigurationV7({ environment: partial }),
        configurationCode("environment"),
      );
    }
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("v7 binds the optional Agent provider to the installed Execution Image as one all-or-none selection", async () => {
  const value = await fixture();
  try {
    const environment = {
      ...value.environment,
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerPath]: value.executablePath,
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerHost]: "unix:///private/test-docker.sock",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerConfig]: value.dockerConfig,
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageId]: "execution-image.agent.test.v1",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageDigest]:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageArchitecture]: "arm64",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionRunnerContractDigest]:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionRunnerImplementationDigest]:
        "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionToolInventoryDigest]:
        "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionCodexVersion]: "0.153.4",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionCodexExecutableIdentity]:
        "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionAgentAdapterImplementationDigest]:
        "sha256:6666666666666666666666666666666666666666666666666666666666666666",
    };
    const configuration = await resolveFoundationInstalledRuntimeConfigurationV7({ environment });
    assert.deepEqual(configuration.execution?.image.agentProvider, {
      codexVersion: "0.153.4",
      executableIdentity:
        "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      adapterImplementationDigest:
        "sha256:6666666666666666666666666666666666666666666666666666666666666666",
    });
    const processConfiguration = selectFoundationProcessRuntimeConfigurationV7(configuration);
    assert.deepEqual(processConfiguration.execution!.image.agentProvider, configuration.execution!.image.agentProvider);
    assert.notEqual(processConfiguration.execution!.image.agentProvider, configuration.execution!.image.agentProvider);
    assert(Object.isFrozen(processConfiguration.execution!.image.agentProvider));

    for (const name of [
      FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionCodexVersion,
      FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionCodexExecutableIdentity,
      FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionAgentAdapterImplementationDigest,
    ]) {
      const partial: NodeJS.ProcessEnv = { ...environment };
      delete partial[name];
      await assert.rejects(
        resolveFoundationInstalledRuntimeConfigurationV7({ environment: partial }),
        configurationCode("execution-agent-image"),
      );
    }

    await assert.rejects(resolveFoundationInstalledRuntimeConfigurationV7({
      environment: {
        ...value.environment,
        [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionCodexVersion]: "0.153.4",
      },
    }), configurationCode("environment"));
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("v7 refuses noncanonical or unowned machine and provider custody", async () => {
  const value = await fixture();
  try {
    const linkedHome = join(value.root, "linked-machine-home");
    await symlink(value.machineHome, linkedHome);
    await assert.rejects(resolveFoundationInstalledRuntimeConfigurationV7({
      environment: {
        ...value.environment,
        LIFECYCLE_MACHINE_HOME: linkedHome,
      },
    }), configurationCode("directory"));

    const executionEnvironment: NodeJS.ProcessEnv = {
      ...value.environment,
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerPath]: value.executablePath,
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerHost]:
        "unix:///private/test-docker.sock",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerConfig]: value.dockerConfig,
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageId]:
        "execution-image.test.v1",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageDigest]:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionImageArchitecture]: "arm64",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionRunnerContractDigest]:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionRunnerImplementationDigest]:
        "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.executionToolInventoryDigest]:
        "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    };
    const linkedDocker = join(value.root, "linked-docker");
    await symlink(value.executablePath, linkedDocker);
    await assert.rejects(resolveFoundationInstalledRuntimeConfigurationV7({
      environment: {
        ...executionEnvironment,
        [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.dockerPath]: linkedDocker,
      },
    }), configurationCode("docker-executable"));

    await chmod(value.executablePath, 0o600);
    await assert.rejects(resolveFoundationInstalledRuntimeConfigurationV7({
      environment: executionEnvironment,
    }), configurationCode("docker-executable"));
    await chmod(value.executablePath, 0o700);

    const originalGeteuid = process.geteuid;
    Object.defineProperty(process, "geteuid", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: () => (originalGeteuid?.() ?? 0) + 1,
    });
    try {
      await assert.rejects(resolveFoundationInstalledRuntimeConfigurationV7({
        environment: value.environment,
      }), configurationCode("directory-owner"));
    } finally {
      Object.defineProperty(process, "geteuid", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: originalGeteuid,
      });
    }
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("v7 requires the isolated Codex home at its fixed canonical machine-home child", async () => {
  const value = await fixture();
  try {
    await rm(value.codexHome, { recursive: true, force: true });
    await assert.rejects(resolveFoundationInstalledRuntimeConfigurationV7({
      environment: value.environment,
    }), configurationCode("directory"));

    const elsewhere = join(value.root, "elsewhere-codex-home");
    await mkdir(elsewhere, { mode: 0o700 });
    await symlink(elsewhere, value.codexHome);
    await assert.rejects(resolveFoundationInstalledRuntimeConfigurationV7({
      environment: value.environment,
    }), configurationCode("directory"));
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
