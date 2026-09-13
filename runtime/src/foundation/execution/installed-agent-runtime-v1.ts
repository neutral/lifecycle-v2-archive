import type {
  FoundationAgentCellImageV1,
  FoundationAgentCellInstalledInputsV1,
  FoundationAgentCellRuntimeV1,
  FoundationAgentCellOperationRequestV1,
  FoundationAgentCellOperationResultV1,
} from "../attempt/execution-cell-v1.js";
import { operateFoundationAgentCellV1 } from "../attempt/execution-cell-v1.js";
import type {
  AgentAttemptExecutionPolicy,
  AgentAttemptInvestment,
  AgentAttemptProvider,
} from "../control/agent-attempt.js";
import { satisfies } from "semver";
import { FOUNDATION_PROVIDER_PROTOCOL } from "../constants.js";
import { FoundationError } from "../error.js";
import type {
  FoundationInstalledRuntimeConfigurationV7,
  FoundationProcessRuntimeConfigurationV7,
} from "../installed-configuration-v7.js";
import {
  FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR,
} from "../repository/contract.js";
import {
  canonicalJson,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import type {
  FoundationExecutionSpecificationV1,
} from "./contracts.js";
import { parseFoundationExecutionBackendProfile } from "./contracts.js";
import { compileFoundationInstalledAgentExecutionPolicyV1 } from "./installed-agent-policy-v1.js";
import { createFoundationDockerExecutionBackend } from "./docker-backend.js";
import { FoundationDockerExecutionBindingRegistryV1 } from "./docker-binding-registry-v1.js";
import {
  createFoundationDockerCliEngineDriverV1,
  type FoundationDockerAgentProviderSupportResolverV1,
  type FoundationDockerInputSetTransportResolverV1,
  type FoundationDockerInputSetTransportV1,
  type FoundationDockerCliImageInstallationV1,
  assertFoundationDockerCliImageInstallationV1,
} from "./docker-cli-engine-driver-v1.js";
import { foundationDockerExecutionBackendProfileV1 } from "./docker-profile-v1.js";
import { openFoundationProviderCredentialCustodyV1 } from "./provider-credential-custody-v1.js";
import type {
  FoundationExecutionInputResolverV1,
  FoundationExecutionInputSetV1,
} from "./input-set.js";
import { createFoundationExecutionOutputStoreV1 } from "./output-store-v1.js";
import { withFoundationInstalledReclamationMaintenanceV1 } from "./installed-reclamation-maintenance-v1.js";
import {
  openFoundationExecutionReclamationLedgerV1,
} from "./reclamation-ledger-v1.js";

type RegisteredInput = Readonly<{
  inputSet: FoundationExecutionInputSetV1;
  resolver: FoundationExecutionInputResolverV1;
}>;

type InputSnapshot = Readonly<{
  path: string;
  byteLength: number;
  digest: Sha256;
  modeClass: "regular" | "executable";
  bytes: Uint8Array;
}>;

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.execution.installed-agent-runtime-v1.${code}`, message);
}

function exactExecutionPolicy(
  value: AgentAttemptExecutionPolicy,
): AgentAttemptExecutionPolicy {
  const keys = Object.keys(value).sort();
  const expected = Object.keys(compileFoundationInstalledAgentExecutionPolicyV1().executionPolicy).sort();
  if (canonicalJson(keys) !== canonicalJson(expected)) {
    fail("execution-policy", "Agent execution policy is not the exact five-policy selection");
  }
  const policy = Object.freeze({
    cancellationPolicyDigest: value.cancellationPolicyDigest,
    containmentPolicyDigest: value.containmentPolicyDigest,
    parentLossPolicyDigest: value.parentLossPolicyDigest,
    retirementPolicyDigest: value.retirementPolicyDigest,
    recoveryPolicyDigest: value.recoveryPolicyDigest,
  });
  const digests = Object.values(policy);
  if (digests.some((digest) => !SHA256.test(digest)) || new Set(digests).size !== digests.length) {
    fail("execution-policy", "Agent execution policy requires five distinct exact digests");
  }
  return policy;
}

export type FoundationCompiledInstalledAgentCellInputsV1 = Readonly<{
  installed: FoundationAgentCellInstalledInputsV1;
  executionPolicy: AgentAttemptExecutionPolicy;
  policyDigests: readonly Sha256[];
}>;

/** Resolve public provider identity only; allocation independently verifies the Image. */
export function selectFoundationInstalledAgentProviderV1(
  configuration: FoundationProcessRuntimeConfigurationV7,
): AgentAttemptProvider {
  const provider = configuration.execution?.image.agentProvider;
  if (provider === undefined) fail("installed-provider", "Agent resources require the selected Image's provider support");
  const descriptor = FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR;
  return Object.freeze({ descriptorId: descriptor.id, descriptorDigest: descriptor.digest,
    executableIdentityClass: descriptor.provider.executableIdentityClass,
    installedIdentityDigest: provider.executableIdentity });
}

/**
 * Compile the one production Agent selection. This is deliberately not a
 * policy framework: the fixed execution-policy compiler owns all five Attempt
 * policy subjects, including the executable channel and credential boundary.
 */
export function compileFoundationInstalledAgentCellInputsV1(input: Readonly<{
  configuration: FoundationProcessRuntimeConfigurationV7;
  provider: AgentAttemptProvider;
  investment: Pick<AgentAttemptInvestment, "model" | "reasoning">;
  executionPolicy: AgentAttemptExecutionPolicy;
}>): FoundationCompiledInstalledAgentCellInputsV1 {
  const execution = input.configuration.execution;
  const imageProvider = execution?.image.agentProvider;
  const descriptor = FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR;
  const adapter = descriptor.adapter;
  if (execution === undefined || imageProvider === undefined ||
      execution.image.runnerContractId !== "lifecycle.execution-cell-runner.v1" ||
      !SHA256.test(execution.image.imageDigest) ||
      !SHA256.test(execution.image.runnerContractDigest) ||
      !SHA256.test(execution.image.runnerImplementationDigest) ||
      !SHA256.test(execution.image.toolInventoryDigest) ||
      !SHA256.test(imageProvider.executableIdentity) ||
      !SHA256.test(imageProvider.adapterImplementationDigest) ||
      imageProvider.adapterImplementationDigest !==
        execution.image.runnerImplementationDigest ||
      descriptor.schema !== "lifecycle.provider-descriptor.v7" ||
      adapter.protocol !== FOUNDATION_PROVIDER_PROTOCOL ||
      adapter.protocol !== "lifecycle.provider-adapter.v7" ||
      descriptor.execution.runnerRequirements.contractId !==
        "lifecycle.execution-cell-runner.v1" ||
      descriptor.execution.runnerRequirements.containmentMechanism !== "execution-backend" ||
      descriptor.controlPlane.networkRequirement !== "fixed-service-channel" ||
      descriptor.controlPlane.authenticationRequirement !== "fixed-runner" ||
      descriptor.controlPlane.agentToolAccess !== false ||
      descriptor.controlPlane.outputDisclosure !== false ||
      descriptor.capabilitySupport.externalEffects !== false ||
      descriptor.capabilitySupport.subprocessModes.some((mode) =>
        mode !== "none" && mode !== "repository-toolchain") ||
      !satisfies(imageProvider.codexVersion, descriptor.provider.compatibleVersion)) {
    fail(
      "installed-provider",
      "Installed Agent image does not satisfy the exact Provider Descriptor v7 and fixed runner-adapter selection",
    );
  }
  const provider = selectFoundationInstalledAgentProviderV1(input.configuration);
  if (canonicalJson(input.provider) !== canonicalJson(provider) ||
      input.investment.model !== input.configuration.model ||
      input.investment.reasoning !== input.configuration.reasoning) {
    fail(
      "attempt-provider",
      "Agent Provider Input or Investment differs from the exact installed selection",
    );
  }
  const executionPolicy = exactExecutionPolicy(input.executionPolicy);
  const fixedExecutionPolicy = compileFoundationInstalledAgentExecutionPolicyV1();
  if (canonicalJson(executionPolicy) !== canonicalJson(fixedExecutionPolicy.executionPolicy)) {
    fail(
      "execution-policy",
      "Agent execution policy differs from the exact installed network, provider-channel, credential, and recovery selection",
    );
  }
  const profile = foundationDockerExecutionBackendProfileV1();
  if (profile.isolation.mechanism !== "oci-container" ||
      profile.isolation.dockerSocket !== false || profile.isolation.privileged !== false ||
      profile.isolation.nonRootRunner !== true ||
      profile.isolation.canonicalRepositoryMount !== false ||
      profile.isolation.runtimeCustodyMount !== false ||
      !profile.networkPolicy.providerControlPlaneModes.includes("fixed-service-channel") ||
      !profile.credentialPolicy.injectionModes.includes("fixed-runner")) {
    fail("backend-profile", "Installed Docker profile cannot host the fixed Agent selection");
  }
  const image: FoundationAgentCellImageV1 = Object.freeze({
    imageId: execution.image.imageId,
    imageDigest: execution.image.imageDigest,
    runnerContractDigest: execution.image.runnerContractDigest,
    runnerImplementationDigest: execution.image.runnerImplementationDigest,
    toolInventoryDigest: execution.image.toolInventoryDigest,
  });
  const executionBoundaryPolicyDigest = executionPolicy.containmentPolicyDigest;
  const installed: FoundationAgentCellInstalledInputsV1 = Object.freeze({
    profile,
    image,
    provider,
    adapterImplementationDigest: imageProvider.adapterImplementationDigest,
    environment: Object.freeze([]),
    capabilities: Object.freeze({
      temporaryWrites: true,
      subprocesses: "repository-toolchain" as const,
      externalEffects: false,
    }),
    networkPolicy: Object.freeze({
      agentProductNetwork: "none" as const,
      agentPolicyDigest: executionBoundaryPolicyDigest,
      providerControlPlane: "fixed-service-channel" as const,
      providerPolicyDigest: executionBoundaryPolicyDigest,
      separationRequired: true as const,
    }),
    credentialPolicy: Object.freeze({
      mode: "fixed-runner" as const,
      bindings: Object.freeze([Object.freeze({
        id: "provider-control",
        policyDigest: executionBoundaryPolicyDigest,
      })]),
      agentAccess: false as const,
      outputDisclosure: false as const,
    }),
  });
  return Object.freeze({
    installed,
    executionPolicy,
    policyDigests: Object.freeze(Object.values(executionPolicy)),
  });
}

/**
 * Execution-owned logical-to-Docker transport for Agent Input Sets. It retains
 * only the immutable resolver supplied by the owner. No host path, Cell
 * coordinate, credential, or provider-control value crosses this seam.
 */
export class FoundationAgentCellInputTransportRegistryV1
implements FoundationDockerInputSetTransportResolverV1 {
  readonly #values = new Map<Sha256, RegisteredInput>();

  register(
    inputSet: FoundationExecutionInputSetV1,
    resolver: FoundationExecutionInputResolverV1,
  ): void {
    if (inputSet.owner.kind !== "agent-attempt") {
      fail("input-owner", "Agent input transport cannot register another operation owner");
    }
    const existing = this.#values.get(inputSet.digest);
    if (existing !== undefined &&
        canonicalJson(existing.inputSet) !== canonicalJson(inputSet)) {
      fail("input-substitution", "Agent input transport substituted one retained digest");
    }
    this.#values.set(inputSet.digest, Object.freeze({ inputSet, resolver }));
  }

  async open(
    specification: FoundationExecutionSpecificationV1,
  ): Promise<FoundationDockerInputSetTransportV1> {
    if (specification.owner.kind !== "agent-attempt") {
      fail("input-owner", "Agent input transport received another operation owner");
    }
    const retained = this.#values.get(specification.inputSet.digest);
    if (retained === undefined || retained.inputSet.digest !== specification.inputSet.digest) {
      fail("input-unavailable", "Exact Agent Input Set transport is not registered for recovery");
    }
    const snapshots: InputSnapshot[] = [];
    for (const entry of retained.inputSet.entries) {
      const proof = await retained.resolver.verifyEntry(Object.freeze({
        path: entry.path,
        purpose: entry.purpose,
        mediaType: entry.mediaType,
        modeClass: entry.modeClass,
        sourceSubjectDigest: entry.sourceSubjectDigest,
      }));
      if (proof.immutable !== true ||
          canonicalJson(proof.descriptor) !== canonicalJson(entry) ||
          !(proof.bytes instanceof Uint8Array) ||
          proof.bytes.byteLength !== entry.byteLength ||
          sha256Bytes(proof.bytes) !== entry.digest) {
        fail("input-substitution", "Agent input transport resolver substituted exact entry bytes");
      }
      snapshots.push(Object.freeze({
        path: entry.path,
        byteLength: entry.byteLength,
        digest: entry.digest,
        modeClass: entry.modeClass,
        bytes: Uint8Array.from(proof.bytes),
      }));
    }
    return Object.freeze({
      inputSet: retained.inputSet,
      inputSetDigest: retained.inputSet.digest,
      async *entries() {
        for (const snapshot of snapshots) {
          const bytes = Uint8Array.from(snapshot.bytes);
          yield Object.freeze({
            path: snapshot.path,
            byteLength: snapshot.byteLength,
            digest: snapshot.digest,
            modeClass: snapshot.modeClass,
            async *read() { yield Uint8Array.from(bytes); },
          });
        }
      },
    });
  }
}

class FoundationInstalledAgentProviderSupportV1
implements FoundationDockerAgentProviderSupportResolverV1 {
  readonly installation: FoundationDockerAgentProviderSupportResolverV1["installation"];
  readonly #codexHome: string;
  readonly #now: () => string;
  #openedCustody: ReturnType<typeof openFoundationProviderCredentialCustodyV1> | undefined;
  readonly #credentialPolicy: FoundationAgentCellInstalledInputsV1["credentialPolicy"];

  constructor(input: Readonly<{
    configuration: FoundationInstalledRuntimeConfigurationV7;
    installed: FoundationAgentCellInstalledInputsV1;
    now: () => string;
  }>) {
    this.#now = input.now;
    this.#codexHome = input.configuration.codexHome;
    this.#credentialPolicy = input.installed.credentialPolicy;
    const imageProvider = input.configuration.execution?.image.agentProvider;
    if (imageProvider === undefined ||
        input.installed.provider.installedIdentityDigest !== imageProvider.executableIdentity ||
        input.installed.adapterImplementationDigest !== imageProvider.adapterImplementationDigest) {
      fail(
        "provider-image",
        "Installed Agent provider identity is not bound to the immutable Execution Image",
      );
    }
    this.installation = Object.freeze({
      providerDescriptorDigest: input.installed.provider.descriptorDigest,
      adapterImplementationDigest: input.installed.adapterImplementationDigest,
      executableIdentity: imageProvider.executableIdentity,
      codexVersion: imageProvider.codexVersion,
      model: input.configuration.model,
      reasoning: input.configuration.reasoning,
    });
  }

  async #custody() {
    // Opening a read surface never provisions or reads provider authentication.
    // The first exact driver request owns this private transition.
    const opening = this.#openedCustody ??= openFoundationProviderCredentialCustodyV1({
      codexHome: this.#codexHome,
      now: this.#now,
    });
    try { return await opening; }
    catch (error) {
      if (this.#openedCustody === opening) this.#openedCustody = undefined;
      throw error;
    }
  }

  #assertBinding(input: Parameters<FoundationDockerAgentProviderSupportResolverV1["openCredential"]>[0]) {
    if (!SHA256.test(input.subject.specificationDigest) ||
        this.#credentialPolicy.mode !== "fixed-runner" ||
        this.#credentialPolicy.agentAccess !== false ||
        this.#credentialPolicy.outputDisclosure !== false ||
        this.#credentialPolicy.bindings.length !== 1 ||
        canonicalJson(this.#credentialPolicy.bindings[0]) !==
          canonicalJson(input.credentialBinding)) {
      fail("provider-credential", "Agent Cell requested another installed credential binding");
    }
  }

  async claimCredential(input: Parameters<FoundationDockerAgentProviderSupportResolverV1["claimCredential"]>[0]) {
    this.#assertBinding(input);
    await (await this.#custody()).claim(input.subject);
  }

  async hasCredentialClaim(input: Parameters<FoundationDockerAgentProviderSupportResolverV1["hasCredentialClaim"]>[0]) {
    this.#assertBinding(input);
    return await (await this.#custody()).hasClaim(input.subject);
  }

  async openCredential(input: Parameters<FoundationDockerAgentProviderSupportResolverV1["openCredential"]>[0]) {
    this.#assertBinding(input);
    return await (await this.#custody()).read(input.subject);
  }

  async credentialSettlement(input: Parameters<FoundationDockerAgentProviderSupportResolverV1["credentialSettlement"]>[0]) {
    this.#assertBinding(input);
    return await (await this.#custody()).settlement(input.subject) !== null;
  }

  async settleCredential(input: Parameters<FoundationDockerAgentProviderSupportResolverV1["settleCredential"]>[0]) {
    this.#assertBinding(input);
    await (await this.#custody()).settle(input.subject, input.outcome);
  }

  async forgetCredentialSettlement(input: Parameters<FoundationDockerAgentProviderSupportResolverV1["forgetCredentialSettlement"]>[0]) {
    this.#assertBinding(input);
    await (await this.#custody()).forgetSettlement(input.subject);
  }

}

export type FoundationOpenedInstalledAgentRuntimeV1 = Readonly<{
  installed: FoundationAgentCellInstalledInputsV1;
  operate(input: FoundationAgentCellOperationRequestV1): Promise<FoundationAgentCellOperationResultV1>;
  reclaimNext(): Promise<boolean>;
  close(): void;
}>;

export type FoundationInstalledAgentRuntimeOpenerV1 = (
  input: Readonly<{
    installed: FoundationAgentCellInstalledInputsV1;
    investment: Pick<AgentAttemptInvestment, "model" | "reasoning">;
    image: FoundationDockerCliImageInstallationV1;
    now: () => string;
  }>,
) => Promise<FoundationOpenedInstalledAgentRuntimeV1>;

/** Bind installation custody once; Process cannot choose an Engine or credential root. */
export function bindFoundationInstalledAgentRuntimeV1(
  configuration: FoundationInstalledRuntimeConfigurationV7,
): FoundationInstalledAgentRuntimeOpenerV1 {
  return async ({ installed, investment, image, now }) => await openFoundationInstalledAgentRuntimeV1({
    installed,
    now,
    configuration: Object.freeze({
      ...configuration,
      ...(configuration.execution === undefined ? {} : {execution:Object.freeze({...configuration.execution,image})}),
      model: investment.model,
      reasoning: investment.reasoning,
    }),
  });
}

/** Execution composition retains the Backend, input transport, and ledger. */
export function createFoundationAgentCellOperatorV1(input: Readonly<{
  installed: FoundationAgentCellInstalledInputsV1;
  runtime: FoundationAgentCellRuntimeV1;
  inputTransport: FoundationAgentCellInputTransportRegistryV1;
}>): Pick<FoundationOpenedInstalledAgentRuntimeV1, "installed" | "operate"> {
  return Object.freeze({
    installed: input.installed,
    async operate(request: FoundationAgentCellOperationRequestV1) {
      if (canonicalJson(request.installed) !== canonicalJson(input.installed)) {
        fail("installed-substitution", "Agent execution request selected another installed Cell");
      }
      input.inputTransport.register(request.compiledInput.inputSet, request.compiledInput.resolver);
      return await operateFoundationAgentCellV1({ ...request, runtime: input.runtime });
    },
  });
}

/** Compose the installed Agent Cell owner with its bounded private maintenance. */
export function createFoundationMaintainedAgentCellOperatorV1(input: Readonly<{
  installed: FoundationAgentCellInstalledInputsV1;
  runtime: FoundationAgentCellRuntimeV1;
  inputTransport: FoundationAgentCellInputTransportRegistryV1;
  engineIdentityDigest(): Promise<Sha256>;
}>): Pick<FoundationOpenedInstalledAgentRuntimeV1, "installed" | "operate" | "reclaimNext"> {
  const operator = createFoundationAgentCellOperatorV1(input);
  return Object.freeze({
    installed: operator.installed,
    ...withFoundationInstalledReclamationMaintenanceV1({
      ledger: input.runtime.reclamation, backend: input.runtime.backend, image: input.installed.image,
      engineIdentityDigest: input.engineIdentityDigest,
      agent: {
        credentialPolicy: input.installed.credentialPolicy,
        networkPolicy: input.installed.networkPolicy,
        providerDescriptorDigest: input.installed.provider.descriptorDigest,
        adapterImplementationDigest: input.installed.adapterImplementationDigest,
      },
      operate: operator.operate,
    }),
  });
}

/**
 * Open the production Docker mechanics selected for Agent Attempts. Provider
 * authentication has one durable private claim before Cell creation. Dispatch
 * receives its retained snapshot; retirement settles refreshed authentication.
 * Neither credential generation enters logical Input or operation checkpoints.
 */
export async function openFoundationInstalledAgentRuntimeV1(input: Readonly<{
  configuration: FoundationInstalledRuntimeConfigurationV7;
  installed: FoundationAgentCellInstalledInputsV1;
  now: () => string;
}>): Promise<FoundationOpenedInstalledAgentRuntimeV1> {
  const installed = input.configuration.execution;
  if (installed === undefined) {
    fail(
      "unconfigured",
      "Agent execution requires one exact installed Docker Engine and Execution Image selection",
    );
  }
  const profile = parseFoundationExecutionBackendProfile(input.installed.profile);
  assertFoundationDockerCliImageInstallationV1(installed.image);
  if (profile.profileId !== "lifecycle.execution-backend-profile.docker-local.v1" ||
      input.installed.image.imageId !== installed.image.imageId ||
      input.installed.image.imageDigest !== installed.image.imageDigest ||
      input.installed.image.runnerContractDigest !== installed.image.runnerContractDigest ||
      input.installed.image.runnerImplementationDigest !== installed.image.runnerImplementationDigest ||
      input.installed.image.toolInventoryDigest !== installed.image.toolInventoryDigest ||
      input.installed.networkPolicy.agentProductNetwork !== "none" ||
      input.installed.networkPolicy.providerControlPlane !== "fixed-service-channel" ||
      input.installed.networkPolicy.providerPolicyDigest === null ||
      input.installed.networkPolicy.separationRequired !== true ||
      input.installed.credentialPolicy.mode !== "fixed-runner" ||
      input.installed.credentialPolicy.bindings.length !== 1 ||
      input.installed.credentialPolicy.bindings[0]?.id !== "provider-control" ||
      input.installed.credentialPolicy.agentAccess !== false ||
      input.installed.credentialPolicy.outputDisclosure !== false) {
    fail("installed-selection", "Agent runtime selection differs from its exact installed Docker profile and policies");
  }
  const inputTransport = new FoundationAgentCellInputTransportRegistryV1();
  const bindingRegistry = new FoundationDockerExecutionBindingRegistryV1();
  const providerSupport = new FoundationInstalledAgentProviderSupportV1({
    configuration: input.configuration,
    installed: input.installed,
    now: input.now,
  });
  const driver = await createFoundationDockerCliEngineDriverV1({
    profile,
    dockerExecutable: installed.dockerExecutable,
    dockerExecutableDigest: installed.dockerExecutableDigest,
    engineEndpoint: installed.engineEndpoint,
    dockerConfigDirectory: installed.dockerConfigDirectory,
    images: Object.freeze([installed.image]),
    inputTransport,
    agentProviderSupport: providerSupport,
    observationSequence: bindingRegistry.observationSequence,
    now: input.now,
  });
  const engine = await driver.describe();
  const backend = await createFoundationDockerExecutionBackend({
    profile,
    driver,
    resolveBinding: bindingRegistry.resolve,
    now: input.now,
  });
  const ledger = await openFoundationExecutionReclamationLedgerV1({
    machineHome: input.configuration.machineHome,
    installationId: input.configuration.installationId,
    create: true,
    clock: Object.freeze({ now: input.now }),
  });
  const runtime: FoundationAgentCellRuntimeV1 = Object.freeze({
    machineHome: input.configuration.machineHome,
    backend,
    registerOperation({ specification, persistence }): void {
      bindingRegistry.register({
        specification,
        engineIdentityDigest: engine.engineIdentityDigest,
        persistence,
      });
    },
    outputStore: createFoundationExecutionOutputStoreV1({
      machineHome: input.configuration.machineHome,
    }),
    reclamation: ledger,
    clock: Object.freeze({ now: input.now }),
    pollMilliseconds: 100,
  });
  return Object.freeze({
    ...createFoundationMaintainedAgentCellOperatorV1({
      installed: input.installed, runtime, inputTransport,
      engineIdentityDigest: async () => (await driver.describe()).engineIdentityDigest,
    }),
    close(): void { ledger.close(); },
  });
}
