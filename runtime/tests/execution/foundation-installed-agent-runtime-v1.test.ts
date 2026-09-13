import { compileFoundationAgentExecutionSelectionV1, parseFoundationAgentExecutionSelectionV1 } from "../../src/foundation/execution/agent-selection-v1.js";
import { digestCanonical } from "../../src/foundation/validation/canonical.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  compileFoundationInstalledAgentCellInputsV1,
} from "../../src/foundation/execution/installed-agent-runtime-v1.js";
import { compileFoundationInstalledAgentExecutionPolicyV1 } from "../../src/foundation/execution/installed-agent-policy-v1.js";
import {
  FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR,
} from "../../src/foundation/repository/contract.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";

type CompilerInput = Parameters<typeof compileFoundationInstalledAgentCellInputsV1>[0];

function input(codexVersion: string): CompilerInput {
  const descriptor = FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR;
  const executableIdentity = sha256Bytes("installed Codex 0.153.4 executable");
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
      specificationRevision: "lifecycle.foundation.1.0.0-rc.17" as const,
      publicationDigest: digest("publication"),
      execution: Object.freeze({
        dockerExecutable: "/usr/bin/docker",
        dockerExecutableDigest: digest("docker executable"),
        engineEndpoint: "unix:///private/docker.sock",
        dockerConfigDirectory: "/private/docker-config",
        image: Object.freeze({
          imageId: "lifecycle.execution-image.codex-standard.v1",
          imageDigest: digest("image"),
          immutableReference: `registry.example/lifecycle@${digest("image")}`,
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

test("installed Agent selection admits the exact Codex image and refuses versions outside its selected range", () => {
  const selected = compileFoundationInstalledAgentCellInputsV1(input("0.153.4"));
  assert.equal(
    FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.provider.compatibleVersion,
    ">=0.153.4 <0.154.0",
  );
  assert.equal(selected.installed.provider.descriptorDigest,
    FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.digest);

  for (const version of ["0.150.1", "0.151.0", "0.152.0", "0.153.3", "0.154.0"]) {
    assert.throws(
      () => compileFoundationInstalledAgentCellInputsV1(input(version)),
      /does not satisfy the exact Provider Descriptor v7 and fixed runner-adapter selection/u,
    );
  }
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
    credentialTransport: "exclusive-execution-snapshot-and-private-provider-state-volume",
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

  const substituted = input("0.153.4");
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


test("Agent execution selection retains exact resource and policy values without custody locators", () => {
  const selected = input("0.153.4");
  const compiled = compileFoundationInstalledAgentCellInputsV1(selected);
  const retained = compileFoundationAgentExecutionSelectionV1({compiled,image:selected.configuration.execution!.image,
    providerDescriptor:FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR as unknown as ControlJsonObject,
    policies:compileFoundationInstalledAgentExecutionPolicyV1()});
  assert.deepEqual(parseFoundationAgentExecutionSelectionV1(retained),retained);
  const bytes = JSON.stringify(retained);
  for (const locator of ["engineEndpoint","dockerExecutable","dockerConfigDirectory","codexHome","machineHome","/private/"]) assert.equal(bytes.includes(locator),false,locator);
  assert.equal(retained.policySubjects.length,5);
  const body = {...retained,image:{...retained.image,imageDigest:sha256Bytes("other image")}};
  const {digest:_digest,...value} = body;
  assert.throws(() => parseFoundationAgentExecutionSelectionV1({...value,digest:digestCanonical(value)} as unknown as ControlJsonObject),/incomplete or mutable|substitutes/u);
  const missing = {...retained,policySubjects:retained.policySubjects.slice(1)};
  const {digest:_missingDigest,...missingValue} = missing;
  assert.throws(() => parseFoundationAgentExecutionSelectionV1({...missingValue,digest:digestCanonical(missingValue)} as unknown as ControlJsonObject),/incomplete/u);
  for (const mutation of [
    (value:ControlJsonObject) => ({...value,image:{...value.image as ControlJsonObject,engineEndpoint:"unix:///private/substitute.sock"}}),
    (value:ControlJsonObject) => ({...value,compiled:{...value.compiled as ControlJsonObject,
      installed:{...(value.compiled as ControlJsonObject).installed as ControlJsonObject,codexHome:"/private/substitute-home"}}}),
    (value:ControlJsonObject) => ({...value,providerDescriptor:{...value.providerDescriptor as ControlJsonObject,digest:sha256Bytes("wrong descriptor")}}),
    (value:ControlJsonObject) => ({...value,policySubjects:(value.policySubjects as ControlJsonObject[]).map((subject,index) =>
      index === 0 ? {...subject,value:{...subject.value as ControlJsonObject,changed:true}} : subject)}),
  ]) {
    const mutated = mutation(JSON.parse(bytes) as ControlJsonObject) as ControlJsonObject;
    const {digest:_original,...body} = mutated;
    assert.throws(() => parseFoundationAgentExecutionSelectionV1({...body,digest:digestCanonical(body)}),
      /incomplete or mutable|invalid installed selection|exact digests|selected digest/u);
  }
});
