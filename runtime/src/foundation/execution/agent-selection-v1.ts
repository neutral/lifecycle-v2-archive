import { FoundationError } from "../error.js";
import type { ControlJsonObject } from "../control/types.js";
import { canonicalJson, digestCanonical, selfDigest, type Sha256 } from "../validation/canonical.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import type { FoundationProviderDescriptor } from "../repository/types.js";
import { parseFoundationExecutionBackendProfile } from "./contracts.js";
import { assertFoundationDockerCliImageInstallationV1, type FoundationDockerCliImageInstallationV1 } from "./docker-cli-engine-driver-v1.js";
import type { FoundationCompiledInstalledAgentCellInputsV1 } from "./installed-agent-runtime-v1.js";
import type { FoundationInstalledAgentExecutionPolicySelectionV1 } from "./installed-agent-policy-v1.js";

const SCHEMA = "lifecycle.agent-execution-selection.private.v1" as const;

const POLICY_KEYS = [
  "cancellationPolicyDigest",
  "containmentPolicyDigest",
  "parentLossPolicyDigest",
  "retirementPolicyDigest",
  "recoveryPolicyDigest",
] as const;

export type FoundationAgentExecutionSelectionV1 = ControlJsonObject & Readonly<{
  schema: typeof SCHEMA;
  compiled: FoundationCompiledInstalledAgentCellInputsV1;
  image: FoundationDockerCliImageInstallationV1;
  providerDescriptor: ControlJsonObject;
  policySubjects: readonly Readonly<{
    key: typeof POLICY_KEYS[number];
    id: string;
    digest: Sha256;
    value: ControlJsonObject;
  }>[];
  digest: Sha256;
}>;

function fail(message: string): never {
  throw new FoundationError("lifecycle.execution.agent-selection-v1.binding", message);
}

function exactKeys(value: unknown, keys: readonly string[], label: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    fail(`Agent execution selection has an invalid ${label}`);
  }
}

/** Reopen immutable selected values. This never consults current installed defaults. */
export function parseFoundationAgentExecutionSelectionV1(value: ControlJsonObject): FoundationAgentExecutionSelectionV1 {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(["compiled", "digest", "image", "policySubjects", "providerDescriptor", "schema"]) || value.schema !== SCHEMA) {
    fail("Agent execution selection has an unsupported shape");
  }
  const { digest, ...body } = value;
  if (digestCanonical(body) !== digest) {
    fail("Agent execution selection does not reproduce its exact digest");
  }
  const selected = JSON.parse(canonicalJson(value)) as FoundationAgentExecutionSelectionV1;
  const compiled = selected.compiled;
  if (compiled === null || typeof compiled !== "object" || Array.isArray(compiled) ||
    canonicalJson(Object.keys(compiled).sort()) !== canonicalJson(["executionPolicy", "installed", "policyDigests"])) {
    fail("Agent execution selection omits its compiled subjects");
  }
  exactKeys(compiled.installed, [
    "profile",
    "image",
    "provider",
    "adapterImplementationDigest",
    "environment",
    "capabilities",
    "networkPolicy",
    "credentialPolicy",
  ], "installed selection");
  exactKeys(compiled.installed.image, [
    "imageId",
    "imageDigest",
    "runnerContractDigest",
    "runnerImplementationDigest",
    "toolInventoryDigest",
  ], "Image binding");
  exactKeys(compiled.installed.provider, [
    "descriptorId",
    "descriptorDigest",
    "executableIdentityClass",
    "installedIdentityDigest",
  ], "provider binding");
  exactKeys(compiled.installed.capabilities, ["temporaryWrites", "subprocesses", "externalEffects"], "capabilities");
  exactKeys(compiled.installed.networkPolicy, [
    "agentProductNetwork",
    "agentPolicyDigest",
    "providerControlPlane",
    "providerPolicyDigest",
    "separationRequired",
  ], "network policy");
  exactKeys(compiled.installed.credentialPolicy, ["mode", "bindings", "agentAccess", "outputDisclosure"], "credential policy");
  parseFoundationExecutionBackendProfile(compiled.installed.profile);
  assertFoundationDockerCliImageInstallationV1(selected.image);
  assertFoundationSchema("urn:lifecycle:schema:provider-descriptor:v7", selected.providerDescriptor, "retained-agent-provider");
  const descriptor = selected.providerDescriptor as unknown as FoundationProviderDescriptor;
  if (selfDigest(descriptor) !== descriptor.digest || selfDigest(descriptor.adapter, "implementationDigest") !== descriptor.adapter.implementationDigest) {
    fail("Agent Provider Descriptor does not reproduce its exact digests");
  }
  const { image, provider } = compiled.installed;
  if (image.imageId !== selected.image.imageId || image.imageDigest !== selected.image.imageDigest ||
    image.runnerContractDigest !== selected.image.runnerContractDigest || image.runnerImplementationDigest !== selected.image.runnerImplementationDigest ||
    image.toolInventoryDigest !== selected.image.toolInventoryDigest || selected.image.agentProvider === undefined ||
    provider.installedIdentityDigest !== selected.image.agentProvider.executableIdentity ||
    compiled.installed.adapterImplementationDigest !== selected.image.agentProvider.adapterImplementationDigest ||
    provider.descriptorId !== descriptor.id || provider.descriptorDigest !== descriptor.digest ||
    provider.executableIdentityClass !== descriptor.provider.executableIdentityClass) {
    fail("Agent execution selection substitutes an Image, runner or provider binding");
  }
  exactKeys(compiled.executionPolicy, POLICY_KEYS, "execution policies");
  if (!Array.isArray(compiled.policyDigests) || !Array.isArray(selected.policySubjects) ||
    canonicalJson([...compiled.policyDigests].sort()) !== canonicalJson(Object.values(compiled.executionPolicy).sort()) ||
    selected.policySubjects.length !== POLICY_KEYS.length || new Set(selected.policySubjects.map(({ key }) => key)).size !== POLICY_KEYS.length) {
    fail("Agent execution policy selection is incomplete");
  }
  for (const subject of selected.policySubjects as FoundationAgentExecutionSelectionV1["policySubjects"]) {
    exactKeys(subject, ["key", "id", "digest", "value"], "policy subject");
    if (!POLICY_KEYS.includes(subject.key) || subject.digest !== compiled.executionPolicy[subject.key] ||
      digestCanonical(subject.value) !== subject.digest || subject.value.schema !== subject.id) {
      fail("Agent execution policy subject does not reproduce its selected digest");
    }
  }
  return Object.freeze(selected);
}

/** Select once before allocation, then retain this path-free value in operation custody. */
export function compileFoundationAgentExecutionSelectionV1(input: Readonly<{
  compiled: FoundationCompiledInstalledAgentCellInputsV1;
  image: FoundationDockerCliImageInstallationV1;
  providerDescriptor: ControlJsonObject;
  policies: FoundationInstalledAgentExecutionPolicySelectionV1;
}>): FoundationAgentExecutionSelectionV1 {
  const body = {
    schema: SCHEMA,
    compiled: input.compiled,
    image: input.image,
    providerDescriptor: input.providerDescriptor,
    policySubjects: input.policies.subjects.map(({ key, id, digest, value }) => ({ key, id, digest, value })),
  };
  return parseFoundationAgentExecutionSelectionV1({ ...body, digest: digestCanonical(body) } as unknown as ControlJsonObject);
}
