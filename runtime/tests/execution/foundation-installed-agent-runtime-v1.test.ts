import assert from "node:assert/strict";
import test from "node:test";
import {
  compileFoundationInstalledAgentCellInputsV1,
  compileFoundationInstalledAgentExecutionPolicyV1,
} from "../../src/foundation/execution/installed-agent-runtime-v1.js";
import {
  FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR,
} from "../../src/foundation/repository/contract.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";

type CompilerInput = Parameters<typeof compileFoundationInstalledAgentCellInputsV1>[0];

function input(codexVersion: string): CompilerInput {
  const descriptor = FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR;
  const executableIdentity = sha256Bytes("installed Codex 0.151.0 executable");
  const digest = (label: string) => sha256Bytes(`installed Agent fixture ${label}`);
  const runnerImplementationDigest = digest("runner implementation");
  const adapterImplementationDigest = runnerImplementationDigest;
  return Object.freeze({
    configuration: Object.freeze({
      machineHome: "/private/lifecycle-machine-home",
      installationId: `installation.lifecycle.${"1".repeat(64)}`,
      codexPath: "/private/codex",
      codexHome: "/private/lifecycle-machine-home/codex-exec-home",
      model: "gpt-5.6-sol",
      reasoning: "high",
      specificationRevision: "lifecycle.foundation.1.0.0-rc.10" as const,
      publicationDigest: digest("publication"),
      execution: Object.freeze({
        dockerExecutable: "/usr/bin/docker",
        dockerExecutableDigest: digest("docker executable"),
        engineEndpoint: "unix:///private/docker.sock",
        dockerConfigDirectory: "/private/docker-config",
        image: Object.freeze({
          imageId: "lifecycle.execution-image.codex-standard.v1",
          imageDigest: digest("image"),
          immutableReference: digest("image"),
          configurationDigest: digest("image configuration"),
          platform: Object.freeze({
            os: "linux" as const,
            architecture: "amd64" as const,
            variant: null,
          }),
          nonRootUser: "65532:65532",
          runnerContractId: "lifecycle.execution-cell-runner.v1" as const,
          runnerContractDigest: digest("runner contract"),
          runnerImplementationDigest,
          toolInventoryDigest: digest("tool inventory"),
          agentProvider: Object.freeze({
            codexVersion,
            executableIdentity,
            adapterImplementationDigest,
          }),
        }),
      }),
    }),
    provider: Object.freeze({
      descriptorId: descriptor.id,
      descriptorDigest: descriptor.digest,
      executableIdentityClass: descriptor.provider.executableIdentityClass,
      installedIdentityDigest: executableIdentity,
    }),
    investment: Object.freeze({ model: "gpt-5.6-sol", reasoning: "high" }),
    executionPolicy: compileFoundationInstalledAgentExecutionPolicyV1().executionPolicy,
  });
}

test("installed Agent selection admits the exact rc.10 Codex image and refuses 0.150.x", () => {
  const selected = compileFoundationInstalledAgentCellInputsV1(input("0.151.0"));
  assert.equal(
    FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.provider.compatibleVersion,
    ">=0.151.0 <0.152.0",
  );
  assert.equal(selected.installed.provider.descriptorDigest,
    FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.digest);

  assert.throws(
    () => compileFoundationInstalledAgentCellInputsV1(input("0.150.1")),
    /does not satisfy the exact Provider Descriptor v6 and fixed runner-adapter selection/u,
  );
});

test("installed Agent policy subjects bind the fixed network, provider channel, and credential boundary", () => {
  const selected = compileFoundationInstalledAgentExecutionPolicyV1();
  assert.equal(selected.subjects.length, 5);
  assert.deepEqual(
    selected.subjects.map(({ key }) => key),
    [
      "cancellationPolicyDigest",
      "containmentPolicyDigest",
      "parentLossPolicyDigest",
      "retirementPolicyDigest",
      "recoveryPolicyDigest",
    ],
  );
  const containment = selected.subjects.find(
    ({ key }) => key === "containmentPolicyDigest",
  );
  assert.notEqual(containment, undefined);
  assert.deepEqual(containment!.value, {
    schema: "lifecycle.agent-execution-policy.containment.v1",
    beforeObservation: "required",
    beforeRetirement: "required",
    agentProductNetwork: "none",
    agentToolNetwork: false,
    providerControlPlane: "fixed-service-channel",
    providerControlProtocol: "http-connect-tls-443-only",
    providerControlDestinations: [
      "api.openai.com",
      "auth.openai.com",
      "chatgpt.com",
    ],
    providerControlMaximumConnections: 16,
    providerControlSeparation: "required",
    credentialMode: "fixed-runner",
    credentialBindingId: "provider-control",
    credentialTransport: "operation-scoped-private-tmpfs",
    agentCredentialAccess: false,
    credentialOutputDisclosure: false,
  });
  assert.equal(
    containment!.digest,
    selected.executionPolicy.containmentPolicyDigest,
  );
  assert.equal(
    Buffer.from(containment!.bytes).toString("utf8"),
    `${JSON.stringify(containment!.value, Object.keys(containment!.value).sort())}\n`,
  );

  const substituted = input("0.151.0");
  assert.throws(
    () => compileFoundationInstalledAgentCellInputsV1(Object.freeze({
      ...substituted,
      executionPolicy: Object.freeze({
        ...substituted.executionPolicy,
        containmentPolicyDigest: sha256Bytes("unbound containment policy"),
      }),
    })),
    /differs from the exact installed network, provider-channel, credential, and recovery selection/u,
  );
});
