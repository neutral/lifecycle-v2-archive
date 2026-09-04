import type {
  FoundationAgentCellImageV1,
  FoundationAgentCellInstalledInputsV1,
  FoundationAgentCellRuntimeV1,
  FoundationCompiledAgentCellInputV1,
} from "../attempt/execution-cell-v1.js";
import type {
  AgentAttemptExecutionPolicy,
  AgentAttemptInvestment,
  AgentAttemptProvider,
} from "../control/agent-attempt.js";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { satisfies } from "semver";
import { FOUNDATION_PROVIDER_PROTOCOL } from "../constants.js";
import { FoundationError } from "../error.js";
import type {
  FoundationInstalledRuntimeConfigurationV7,
} from "../installed-configuration-v7.js";
import {
  FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR,
} from "../repository/contract.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import type {
  FoundationExecutionSpecificationV1,
} from "./contracts.js";
import { createFoundationDockerExecutionBackend } from "./docker-backend.js";
import { FoundationDockerExecutionBindingRegistryV1 } from "./docker-binding-registry-v1.js";
import {
  createFoundationDockerCliEngineDriverV1,
  type FoundationDockerAgentProviderSupportResolverV1,
  type FoundationDockerInputSetTransportResolverV1,
  type FoundationDockerInputSetTransportV1,
} from "./docker-cli-engine-driver-v1.js";
import { foundationDockerExecutionBackendProfileV1 } from "./docker-profile-v1.js";
import type {
  FoundationExecutionInputResolverV1,
  FoundationExecutionInputSetV1,
} from "./input-set.js";
import { createFoundationExecutionOutputStoreV1 } from "./output-store-v1.js";
import {
  openFoundationExecutionReclamationLedgerV1,
  type FoundationExecutionReclamationLedgerV1,
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

const MAXIMUM_PROVIDER_AUTH_BYTES = 4 * 1024 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const EXECUTION_POLICY_KEYS = Object.freeze([
  "cancellationPolicyDigest",
  "containmentPolicyDigest",
  "parentLossPolicyDigest",
  "retirementPolicyDigest",
  "recoveryPolicyDigest",
] as const);

type FoundationInstalledAgentExecutionPolicyKeyV1 =
  typeof EXECUTION_POLICY_KEYS[number];

export type FoundationInstalledAgentExecutionPolicySubjectV1 = Readonly<{
  key: FoundationInstalledAgentExecutionPolicyKeyV1;
  id: string;
  value: Readonly<Record<string, unknown>>;
  digest: Sha256;
  bytes: Uint8Array;
}>;

export type FoundationInstalledAgentExecutionPolicySelectionV1 = Readonly<{
  executionPolicy: AgentAttemptExecutionPolicy;
  subjects: readonly FoundationInstalledAgentExecutionPolicySubjectV1[];
}>;

const FIXED_AGENT_EXECUTION_POLICY_DEFINITIONS_V1 = Object.freeze([
  Object.freeze({
    key: "cancellationPolicyDigest" as const,
    id: "lifecycle.agent-execution-policy.cancellation.v1",
    value: Object.freeze({
      schema: "lifecycle.agent-execution-policy.cancellation.v1",
      request: "contain-cell",
      redispatch: "forbidden",
    }),
  }),
  Object.freeze({
    key: "containmentPolicyDigest" as const,
    id: "lifecycle.agent-execution-policy.containment.v1",
    value: Object.freeze({
      schema: "lifecycle.agent-execution-policy.containment.v1",
      beforeObservation: "required",
      beforeRetirement: "required",
      agentProductNetwork: "none",
      agentToolNetwork: false,
      providerControlPlane: "fixed-service-channel",
      providerControlProtocol: "http-connect-tls-443-only",
      providerControlDestinations: Object.freeze([
        "api.openai.com",
        "auth.openai.com",
        "chatgpt.com",
      ]),
      providerControlMaximumConnections: 16,
      providerControlSeparation: "required",
      credentialMode: "fixed-runner",
      credentialBindingId: "provider-control",
      credentialTransport: "operation-scoped-private-tmpfs",
      agentCredentialAccess: false,
      credentialOutputDisclosure: false,
    }),
  }),
  Object.freeze({
    key: "parentLossPolicyDigest" as const,
    id: "lifecycle.agent-execution-policy.parent-loss.v1",
    value: Object.freeze({
      schema: "lifecycle.agent-execution-policy.parent-loss.v1",
      action: "contain-and-retire",
      replacementAllocation: "forbidden",
    }),
  }),
  Object.freeze({
    key: "retirementPolicyDigest" as const,
    id: "lifecycle.agent-execution-policy.retirement.v1",
    value: Object.freeze({
      schema: "lifecycle.agent-execution-policy.retirement.v1",
      beforeReceipt: "required",
      dispatchAuthority: "permanently-consumed-or-revoked",
    }),
  }),
  Object.freeze({
    key: "recoveryPolicyDigest" as const,
    id: "lifecycle.agent-execution-policy.recovery.v1",
    value: Object.freeze({
      schema: "lifecycle.agent-execution-policy.recovery.v1",
      handle: "same-exact-handle",
      redispatch: "forbidden",
    }),
  }),
]);

/**
 * Compile the sole installed Agent execution-policy selection and its exact
 * immutable subject bytes. This is a fixed product selection, not a caller-
 * configurable policy framework.
 */
export function compileFoundationInstalledAgentExecutionPolicyV1():
FoundationInstalledAgentExecutionPolicySelectionV1 {
  const subjects = Object.freeze(FIXED_AGENT_EXECUTION_POLICY_DEFINITIONS_V1.map(
    ({ key, id, value }) => {
      const digest = digestCanonical(value);
      return Object.freeze({
        key,
        id,
        value,
        digest,
        bytes: Uint8Array.from(Buffer.from(`${canonicalJson(value)}\n`, "utf8")),
      });
    },
  ));
  const byKey = new Map(subjects.map((subject) => [subject.key, subject.digest] as const));
  return Object.freeze({
    executionPolicy: Object.freeze({
      cancellationPolicyDigest: byKey.get("cancellationPolicyDigest")!,
      containmentPolicyDigest: byKey.get("containmentPolicyDigest")!,
      parentLossPolicyDigest: byKey.get("parentLossPolicyDigest")!,
      retirementPolicyDigest: byKey.get("retirementPolicyDigest")!,
      recoveryPolicyDigest: byKey.get("recoveryPolicyDigest")!,
    }),
    subjects,
  });
}

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.execution.installed-agent-runtime-v1.${code}`, message);
}

function exactExecutionPolicy(
  value: AgentAttemptExecutionPolicy,
): AgentAttemptExecutionPolicy {
  const keys = Object.keys(value).sort();
  const expected = [...EXECUTION_POLICY_KEYS].sort();
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

/**
 * Compile the one production Agent selection. This is deliberately not a
 * policy framework: the exact fixed compiler above owns all five Attempt
 * policy subjects, including the executable channel and credential boundary.
 */
export function compileFoundationInstalledAgentCellInputsV1(input: Readonly<{
  configuration: FoundationInstalledRuntimeConfigurationV7;
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
      descriptor.schema !== "lifecycle.provider-descriptor.v6" ||
      adapter.protocol !== FOUNDATION_PROVIDER_PROTOCOL ||
      adapter.protocol !== "lifecycle.provider-adapter.v6" ||
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
      "Installed Agent image does not satisfy the exact Provider Descriptor v6 and fixed runner-adapter selection",
    );
  }
  const provider = Object.freeze({
    descriptorId: descriptor.id,
    descriptorDigest: descriptor.digest,
    executableIdentityClass: descriptor.provider.executableIdentityClass,
    installedIdentityDigest: imageProvider.executableIdentity,
  });
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
    policyDigests: Object.freeze(EXECUTION_POLICY_KEYS.map((key) => executionPolicy[key])),
  });
}

/**
 * Process-private logical-to-Docker transport for Agent Input Sets. It retains
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
  readonly #credentialPolicy: FoundationAgentCellInstalledInputsV1["credentialPolicy"];

  constructor(input: Readonly<{
    configuration: FoundationInstalledRuntimeConfigurationV7;
    installed: FoundationAgentCellInstalledInputsV1;
  }>) {
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

  async openCredential(input: Readonly<{
    specificationDigest: Sha256;
    credentialBinding: Readonly<{ id: string; policyDigest: Sha256 }>;
  }>) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(input.specificationDigest) ||
        this.#credentialPolicy.mode !== "fixed-runner" ||
        this.#credentialPolicy.agentAccess !== false ||
        this.#credentialPolicy.outputDisclosure !== false ||
        this.#credentialPolicy.bindings.length !== 1 ||
        canonicalJson(this.#credentialPolicy.bindings[0]) !==
          canonicalJson(input.credentialBinding)) {
      fail("provider-credential", "Agent Cell requested another installed credential binding");
    }
    const path = join(this.#codexHome, "auth.json");
    let handle;
    try {
      const before = await lstat(path);
      const uid = process.getuid?.();
      if (!before.isFile() || before.isSymbolicLink() || before.size < 2 ||
          before.size > MAXIMUM_PROVIDER_AUTH_BYTES || (before.mode & 0o077) !== 0 ||
          (uid !== undefined && before.uid !== uid)) {
        fail("provider-credential", "Installed provider authentication is not one private owned file");
      }
      handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
          opened.size !== before.size || opened.mtimeMs !== before.mtimeMs ||
          opened.ctimeMs !== before.ctimeMs) {
        fail("provider-credential", "Installed provider authentication changed while it was opened");
      }
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (bytes.byteLength !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino ||
          after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
          after.ctimeMs !== opened.ctimeMs) {
        bytes.fill(0);
        fail("provider-credential", "Installed provider authentication changed while it was read");
      }
      const snapshot = Uint8Array.from(bytes);
      bytes.fill(0);
      let consumed = false;
      return Object.freeze({
        byteLength: snapshot.byteLength,
        async *read() {
          if (consumed) fail("provider-credential", "Provider authentication reader was reused");
          consumed = true;
          const transfer = Uint8Array.from(snapshot);
          try { yield transfer; }
          finally {
            transfer.fill(0);
            snapshot.fill(0);
          }
        },
      });
    } catch (error) {
      if (error instanceof FoundationError) throw error;
      fail("provider-credential", "Installed provider authentication could not be opened");
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export type FoundationOpenedInstalledAgentRuntimeV1 = Readonly<{
  runtime: FoundationAgentCellRuntimeV1;
  installed: FoundationAgentCellInstalledInputsV1;
  inputTransport: FoundationAgentCellInputTransportRegistryV1;
  registerInput(compiledInput: FoundationCompiledAgentCellInputV1): void;
  ledger: FoundationExecutionReclamationLedgerV1;
  reclaimNext(): Promise<boolean>;
  close(): void;
}>;

/**
 * Open the production Docker mechanics selected for Agent Attempts. Provider
 * authentication is reopened only by the private driver at exact Cell
 * dispatch and is never part of the logical Input Set or operation checkpoint.
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
  const profile = foundationDockerExecutionBackendProfileV1();
  if (canonicalJson(input.installed.profile) !== canonicalJson(profile) ||
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
    runtime,
    installed: input.installed,
    inputTransport,
    registerInput(compiledInput): void {
      inputTransport.register(compiledInput.inputSet, compiledInput.resolver);
    },
    ledger,
    async reclaimNext(): Promise<boolean> {
      return (await ledger.runNext({
        reclaim: async (handoff) => await backend.reclaim(
          handoff.specification,
          handoff.reclamationBinding,
          handoff.obligation,
        ),
      })) !== null;
    },
    close(): void { ledger.close(); },
  });
}
