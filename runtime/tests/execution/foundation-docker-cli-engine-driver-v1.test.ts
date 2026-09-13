import assert from "node:assert/strict";
import test from "node:test";
import {
  createFoundationDockerCliEngineDriverForTestingV1,
  type FoundationDockerCliCommandExecutorV1,
  type FoundationDockerCliImageInstallationV1,
  type FoundationDockerAgentProviderSupportResolverV1,
  type FoundationDockerInputSetTransportResolverV1,
  type FoundationDockerObservationSequenceV1,
} from "../../src/foundation/execution/docker-cli-engine-driver-v1.js";
import {
  parseFoundationExecutionBackendProfile,
  parseFoundationExecutionSpecification,
  type FoundationExecutionBackendProfileV1,
  type FoundationExecutionSpecificationV1,
} from "../../src/foundation/execution/contracts.js";
import type { FoundationDockerCellCreateRequestV1 } from "../../src/foundation/execution/docker-backend.js";
import type { FoundationExecutionInputSetV1 } from "../../src/foundation/execution/input-set.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
} from "../../src/foundation/validation/canonical.js";
import {
  digest,
  executionContractFixture,
} from "../support/execution-contract-fixture.js";

const EXECUTABLE = "/opt/lifecycle/private/docker";
const ENDPOINT = "unix:///private/docker.sock";
const CONFIGURATION_DIGEST = sha256Bytes("docker-image-configuration");
const CELL_ID = "b".repeat(64);
const STAGING_ID = "a".repeat(64);
const PROVIDER_PROXY_ID = "c".repeat(64);
const PROVIDER_READER_ID = "d".repeat(64);
const ZERO_TAR = Uint8Array.from(Buffer.alloc(1024));
const AUTH_BYTES = Uint8Array.from(Buffer.from('{"tokens":{"access_token":"private-test-token"}}\n', "utf8"));

function tar(entries: readonly Readonly<{ path: string; bytes: Uint8Array; mode: number; type?: "0" | "x" }>[]): Uint8Array {
  const chunks: Buffer[] = [];
  const octal = (header: Buffer, offset: number, length: number, value: number): void => {
    header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
  };
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100, "utf8");
    octal(header, 100, 8, entry.mode);
    octal(header, 108, 8, 0);
    octal(header, 116, 8, 0);
    octal(header, 124, 12, entry.bytes.byteLength);
    octal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    chunks.push(header, Buffer.from(entry.bytes));
    const padding = (512 - (entry.bytes.byteLength % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Uint8Array.from(Buffer.concat(chunks));
}

function outputArchive(selected: Fixture, resultPath = "outputs/result.txt", pathRecord?: Uint8Array): Uint8Array {
  const bytes = Uint8Array.from(Buffer.from("bounded output\n", "utf8"));
  const empty = new Uint8Array(0);
  const entries = Object.freeze([
    Object.freeze({
      path: "outputs/empty.txt",
      entryKind: "file" as const,
      purpose: "agent-work-product" as const,
      mediaType: "text/plain",
      modeClass: "regular" as const,
      byteLength: empty.byteLength,
      digest: sha256Bytes(empty),
    }),
    Object.freeze({
      path: resultPath,
      entryKind: "file" as const,
      purpose: "agent-work-product" as const,
      mediaType: "text/plain",
      modeClass: "regular" as const,
      byteLength: bytes.byteLength,
      digest: sha256Bytes(bytes),
    }),
  ]);
  const subject = {
    schema: "lifecycle.execution-output-manifest.v1",
    specificationDigest: selected.specification.digest,
    inputSetDigest: selected.specification.inputSet.digest,
    imageDigest: selected.specification.image.imageDigest,
    outputContractDigest: selected.specification.outputContract.digest,
    runnerDigest: selected.specification.runner.contractDigest,
    completedAt: "2026-09-01T00:00:01.500Z",
    entries,
    entryCount: entries.length,
    aggregateByteLength: bytes.byteLength,
    entryInventoryDigest: digestCanonical(entries),
  } as const;
  const manifest = Object.freeze({ ...subject, digest: selfDigest(subject) });
  return tar([
    {
      path: ".lifecycle/output-manifest.json",
      bytes: Uint8Array.from(Buffer.from(canonicalJson(manifest), "utf8")),
      mode: 0o644,
    },
    { path: entries[0]!.path, bytes: empty, mode: 0o644 },
    ...(pathRecord === undefined ? [] : [{ path: "PaxHeaders/result", bytes: pathRecord, mode: 0o644, type: "x" as const }]),
    { path: pathRecord === undefined ? entries[1]!.path : "PaxEntry.result", bytes, mode: 0o644 },
  ]);
}

type Fixture = Readonly<{
  profile: FoundationExecutionBackendProfileV1;
  specification: FoundationExecutionSpecificationV1;
  inputSet: FoundationExecutionInputSetV1;
  image: FoundationDockerCliImageInstallationV1;
  request: FoundationDockerCellCreateRequestV1;
}>;

function fixture(): Fixture {
  const base = executionContractFixture("docker-cli-driver");
  assert.equal(base.specification.owner.kind, "agent-attempt");
  assert.equal(base.specification.operation.kind, "agent-attempt");
  const { digest: _oldProfileDigest, ...oldProfile } = base.profile;
  const profileSubject = {
    ...oldProfile,
    profileId: "lifecycle.execution-backend-profile.docker-local.v1",
    backendKind: "docker-local",
    usage: "production",
    implementation: {
      id: "runtime.execution-backend.docker-cli",
      version: "1.0.0",
      implementationDigest: digest("docker-cli-implementation"),
      contractDigest: digest("docker-cli-contract"),
    },
    engineContract: {
      kind: "docker-engine",
      compatibilityProfileId: "docker-engine-api-v1",
      compatibleVersion: "1.48",
      contractDigest: digest("docker-engine-contract"),
    },
    isolation: {
      mechanism: "oci-container",
      nonRootRunner: true,
      privileged: false,
      hostPidNamespace: false,
      hostNetworkNamespace: false,
      dockerSocket: false,
      canonicalRepositoryMount: false,
      runtimeCustodyMount: false,
      completeProcessBoundary: true,
      productionIsolationClaim: true,
    },
    networkPolicy: {
      providerControlPlaneModes: ["none", "fixed-service-channel"],
      agentProductNetworkModes: ["none"],
      separationRequired: true,
    },
    credentialPolicy: {
      injectionModes: ["none", "fixed-runner"],
      agentAccess: false,
      outputDisclosure: false,
      diagnosticDisclosure: false,
    },
  } as const;
  const profile = parseFoundationExecutionBackendProfile({
    ...profileSubject,
    digest: selfDigest(profileSubject),
  });
  const runnerImplementationDigest = digest("cell-runner-implementation");
  const image: FoundationDockerCliImageInstallationV1 = Object.freeze({
    imageId: base.image.imageId,
    imageDigest: base.image.imageDigest,
    immutableReference: `registry.invalid/lifecycle/execution@${base.image.imageDigest}`,
    configurationDigest: CONFIGURATION_DIGEST,
    platform: Object.freeze({ os: "linux", architecture: "amd64", variant: null }),
    nonRootUser: "65532:65532",
    runnerContractId: "lifecycle.execution-cell-runner.v1",
    runnerContractDigest: base.specification.runner.contractDigest,
    runnerImplementationDigest,
    toolInventoryDigest: digest("execution-tool-inventory"),
    agentProvider: Object.freeze({
      codexVersion: "0.153.4",
      executableIdentity: digest("cell-codex-executable"),
      adapterImplementationDigest: runnerImplementationDigest,
    }),
  });
  const inputSetSubject = {
    schema: "lifecycle.execution-input-set.v2" as const,
    owner: {
      kind: "agent-attempt" as const,
      activityId: `activity.docker-cli-driver`,
      attemptId: `attempt.docker-cli-driver`,
      role: "reconnaissance" as const,
      ownerSubjectDigest: digest("driver-input-owner"),
    },
    inputMaterialDigest: digest("driver-input-material"),
    subjects: [],
    entries: [],
    entryCount: 0,
    aggregateByteLength: 0,
    contentInventoryDigest: digestCanonical([]),
    runnerContractDigest: base.specification.runner.contractDigest,
    toolInventoryDigest: image.toolInventoryDigest,
  };
  const inputSet = Object.freeze({
    ...inputSetSubject,
    digest: selfDigest(inputSetSubject),
  }) as FoundationExecutionInputSetV1;
  const { digest: _oldSpecificationDigest, ...oldSpecification } = base.specification;
  const specificationSubject = {
    ...oldSpecification,
    operation: Object.freeze({
      ...oldSpecification.operation,
      adapterImplementationDigest: runnerImplementationDigest,
    }),
    inputSet: {
      profileId: "lifecycle.execution-input-set.v2" as const,
      digest: inputSet.digest,
    },
    backendProfile: {
      profileId: profile.profileId,
      profileDigest: profile.digest,
      implementationDigest: profile.implementation.implementationDigest,
    },
    networkPolicy: {
      agentProductNetwork: "none" as const,
      agentPolicyDigest: digest("agent-network-policy"),
      providerControlPlane: "fixed-service-channel" as const,
      providerPolicyDigest: digest("provider-network-policy"),
      separationRequired: true as const,
    },
    credentialPolicy: {
      mode: "fixed-runner" as const,
      bindings: [Object.freeze({
        id: "provider-control",
        policyDigest: digest("provider-credential-policy"),
      })],
      agentAccess: false as const,
      outputDisclosure: false as const,
    },
  } as const;
  const specification = parseFoundationExecutionSpecification({
    value: { ...specificationSubject, digest: selfDigest(specificationSubject) },
    backendProfile: profile,
    image: base.image,
    inputSet: specificationSubject.inputSet,
  });
  const configurationSubject = {
    schema: "lifecycle.docker-cell-configuration.private.v1",
    image: specification.image,
    runner: specification.runner,
    inputSetDigest: specification.inputSet.digest,
    outputContractDigest: specification.outputContract.digest,
    environment: specification.environment,
    capabilities: specification.capabilities,
    networkPolicy: specification.networkPolicy,
    credentialPolicy: specification.credentialPolicy,
    limits: specification.limits,
    transport: {
      input: "bounded-archive",
      output: "bounded-archive",
      pathFreeRuntimeInterface: true,
    },
    security: {
      nonRootRunner: true,
      privileged: false,
      hostPidNamespace: false,
      hostNetworkNamespace: false,
      dockerSocket: false,
      canonicalRepositoryMount: false,
      runtimeCustodyMount: false,
      hostPathMounts: false,
      restartPolicy: "no",
      rootFilesystem: "read-only",
      addedCapabilities: [],
      noNewPrivileges: true,
      outerSeccomp: "unconfined-for-nested-codex-restricted-read",
      innerAgentToolSandbox: "codex-restricted-read-networkless-v1",
    },
  } as const;
  const configuration = Object.freeze({
    ...configurationSubject,
    digest: selfDigest(configurationSubject),
  });
  const labels = Object.freeze({
    "io.lifecycle.execution-cell.v1.owner": "lifecycle-runtime",
    "io.lifecycle.execution-cell.v1.allocation-key-digest": digest("allocation-key"),
    "io.lifecycle.execution-cell.v1.specification-digest": specification.digest,
    "io.lifecycle.execution-cell.v1.profile-id": profile.profileId,
    "io.lifecycle.execution-cell.v1.profile-digest": profile.digest,
    "io.lifecycle.execution-cell.v1.implementation-digest": profile.implementation.implementationDigest,
    "io.lifecycle.execution-cell.v1.image-digest": specification.image.imageDigest,
    "io.lifecycle.execution-cell.v1.input-set-digest": specification.inputSet.digest,
    "io.lifecycle.execution-cell.v1.output-contract-digest": specification.outputContract.digest,
    "io.lifecycle.execution-cell.v1.runner-contract-digest": specification.runner.contractDigest,
  });
  return Object.freeze({
    profile,
    specification,
    inputSet,
    image,
    request: Object.freeze({
      schema: "lifecycle.docker-cell-create-request.private.v1",
      allocationName: "lifecycle-execution-test",
      labels,
      specification,
      configuration,
    }),
  });
}

type FakeContainer = {
  id: string;
  name: string;
  arguments: readonly string[];
  labels: Record<string, string>;
  networks: Map<string, readonly string[]>;
  state: "created" | "running" | "exited";
  exitCode: number;
  oomKilled: boolean;
  stateError: string;
};

type FakeNetwork = {
  labels: Record<string, string>;
  internal: boolean;
  containers: Set<string>;
};

function values(arguments_: readonly string[], flag: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < arguments_.length - 1; index += 1) {
    if (arguments_[index] === flag) found.push(arguments_[index + 1]!);
  }
  return found;
}

function value(arguments_: readonly string[], flag: string): string | null {
  return values(arguments_, flag)[0] ?? null;
}

function labels(arguments_: readonly string[]): Record<string, string> {
  return Object.fromEntries(values(arguments_, "--label").map((label) => {
    const separator = label.indexOf("=");
    return [label.slice(0, separator), label.slice(separator + 1)];
  }));
}

class FakeDockerCli implements FoundationDockerCliCommandExecutorV1 {
  readonly requests: Parameters<FoundationDockerCliCommandExecutorV1["execute"]>[0][] = [];
  readonly volumes = new Map<string, Record<string, string>>();
  readonly containers = new Map<string, FakeContainer>();
  readonly networks = new Map<string, FakeNetwork>();
  inputArchive: Uint8Array | null = null;
  outputArchive: Uint8Array = ZERO_TAR;
  providerArchive: Uint8Array | null = null;
  providerReady = false;
  providerCredentialBytes: Uint8Array | null = Uint8Array.from(AUTH_BYTES);
  providerCredentialReadFailure = false;
  providerContainmentFailure = false;
  remainingVolumeRemovals = 0;
  readonly inheritedImageLabels = Object.freeze({
    "org.opencontainers.image.source": "https://example.invalid/execution-image",
    "org.opencontainers.image.revision": "immutable-source-revision",
    "io.lifecycle.execution-image.v1.qualification-revision": "lifecycle.foundation.1.0.0-rc.17",
    "io.fixture.execution-image.toolchain": "exact-toolchain",
  });

  constructor(readonly selected: Fixture) {}

  #container(identifier: string): FakeContainer | undefined {
    return this.containers.get(identifier) ??
      [...this.containers.values()].find(({ name }) => name === identifier);
  }

  #result(stdout: string | Uint8Array, exitCode = 0) {
    return Object.freeze({
      exitCode,
      signal: null,
      stdout: typeof stdout === "string" ? Uint8Array.from(Buffer.from(stdout, "utf8")) : stdout,
      stderrTruncated: false,
    });
  }

  async execute(request: Parameters<FoundationDockerCliCommandExecutorV1["execute"]>[0]) {
    this.requests.push(request);
    assert.equal(request.executable, EXECUTABLE);
    assert.deepEqual(request.arguments.slice(0, 2), ["--host", ENDPOINT]);
    const arguments_ = request.arguments.slice(2);
    if (arguments_[0] === "version") {
      return this.#result(`${JSON.stringify({ APIVersion: "1.49", Version: "27.1.0", Os: "linux", Arch: "amd64" })}\n`);
    }
    if (arguments_[0] === "info") {
      return this.#result(`${JSON.stringify({ ID: "engine-identity", OSType: "linux", Architecture: "x86_64" })}\n`);
    }
    if (arguments_[0] === "image" && arguments_[1] === "inspect") {
      return this.#result(`${JSON.stringify({
        Id: CONFIGURATION_DIGEST,
        RepoDigests: [this.selected.image.immutableReference],
        Os: "linux",
        Architecture: "amd64",
        Config: {
          User: this.selected.image.nonRootUser,
          Labels: {
            ...this.inheritedImageLabels,
            "io.lifecycle.execution-image.v1.image-id": this.selected.image.imageId,
            "io.lifecycle.execution-image.v1.runner-contract-id": this.selected.image.runnerContractId,
            "io.lifecycle.execution-image.v1.runner-contract-digest": this.selected.image.runnerContractDigest,
            "io.lifecycle.execution-image.v1.runner-implementation-digest": this.selected.image.runnerImplementationDigest,
            "io.lifecycle.execution-image.v1.tool-inventory-digest": this.selected.image.toolInventoryDigest,
            ...(this.selected.image.agentProvider === undefined ? {} : {
              "io.lifecycle.execution-image.v1.codex-version": this.selected.image.agentProvider.codexVersion,
              "io.lifecycle.execution-image.v1.codex-executable-identity":
                this.selected.image.agentProvider.executableIdentity,
              "io.lifecycle.execution-image.v1.adapter-implementation-digest":
                this.selected.image.agentProvider.adapterImplementationDigest,
            }),
          },
        },
      })}\n`);
    }
    if (arguments_[0] === "volume" && arguments_[1] === "ls") {
      const filters = values(arguments_, "--filter");
      const selected = [...this.volumes].filter(([name, selectedLabels]) =>
        filters.every((filter) => {
          const nameMatch = /^name=\^(.*)\$$/u.exec(filter);
          if (nameMatch !== null) return name === nameMatch[1];
          if (filter.startsWith("label=")) {
            const pair = filter.slice("label=".length);
            const separator = pair.indexOf("=");
            return separator !== -1 &&
              selectedLabels[pair.slice(0, separator)] === pair.slice(separator + 1);
          }
          return false;
        }));
      return this.#result(selected.map(([name]) => name).join("\n") +
        (selected.length === 0 ? "" : "\n"));
    }
    if (arguments_[0] === "volume" && arguments_[1] === "inspect") {
      const selected = this.volumes.get(arguments_[2]!);
      return selected === undefined ? this.#result("", 1) : this.#result(`${JSON.stringify(selected)}\n`);
    }
    if (arguments_[0] === "volume" && arguments_[1] === "create") {
      const name = arguments_.at(-1)!;
      if (!this.volumes.has(name)) this.volumes.set(name, labels(arguments_));
      return this.#result(`${name}\n`);
    }
    if (arguments_[0] === "volume" && arguments_[1] === "rm") {
      if (this.remainingVolumeRemovals > 0) {
        this.remainingVolumeRemovals -= 1;
        return this.#result("", 1);
      }
      return this.#result(this.volumes.delete(arguments_[2]!) ? `${arguments_[2]}\n` : "", 0);
    }
    if (arguments_[0] === "network" && arguments_[1] === "ls") {
      const filters = values(arguments_, "--filter");
      const selected = [...this.networks].filter(([name, network]) => filters.every((filter) => {
        const match = /^name=\^(.*)\$$/u.exec(filter);
        if (match !== null) return name === match[1];
        if (!filter.startsWith("label=")) return false;
        const pair = filter.slice("label=".length);
        const separator = pair.indexOf("=");
        return separator !== -1 && network.labels[pair.slice(0, separator)] === pair.slice(separator + 1);
      }));
      return this.#result(selected.map(([name]) => name).join("\n") + (selected.length === 0 ? "" : "\n"));
    }
    if (arguments_[0] === "network" && arguments_[1] === "inspect") {
      const network = this.networks.get(arguments_[2]!);
      return network === undefined ? this.#result("", 1) : this.#result(`${JSON.stringify({
        Name: arguments_[2],
        Internal: network.internal,
        Labels: network.labels,
        Containers: Object.fromEntries([...network.containers].map((id) => [id, {}])),
      })}\n`);
    }
    if (arguments_[0] === "network" && arguments_[1] === "create") {
      const name = arguments_.at(-1)!;
      this.networks.set(name, {
        labels: labels(arguments_),
        internal: arguments_.includes("--internal"),
        containers: new Set(),
      });
      return this.#result(`${name}\n`);
    }
    if (arguments_[0] === "network" && arguments_[1] === "connect") {
      const network = this.networks.get(arguments_.at(-2)!)!;
      const container = this.#container(arguments_.at(-1)!)!;
      container.networks.set(arguments_.at(-2)!, values(arguments_, "--alias"));
      if (container.state === "running") network.containers.add(container.id);
      return this.#result("");
    }
    if (arguments_[0] === "network" && arguments_[1] === "rm") {
      const network = this.networks.get(arguments_[2]!);
      if (network !== undefined && network.containers.size > 0) return this.#result("", 1);
      this.networks.delete(arguments_[2]!);
      return this.#result(`${arguments_[2]}\n`);
    }
    if (arguments_[0] === "container" && arguments_[1] === "ls") {
      const filters = values(arguments_, "--filter");
      const selected = [...this.containers.values()].filter((container) => filters.every((filter) => {
        if (filter.startsWith("id=")) return container.id === filter.slice(3);
        if (filter.startsWith("name=^/")) return container.name === filter.slice(7, -1);
        if (filter.startsWith("label=")) {
          const pair = filter.slice(6);
          const separator = pair.indexOf("=");
          return container.labels[pair.slice(0, separator)] === pair.slice(separator + 1);
        }
        return false;
      }));
      return this.#result(selected.map(({ id }) => id).join("\n") + (selected.length === 0 ? "" : "\n"));
    }
    if (arguments_[0] === "container" && arguments_[1] === "create") {
      const name = value(arguments_, "--name")!;
      const id = name.endsWith("provider-state-read") ? PROVIDER_READER_ID : name.endsWith("input-stage")
        ? STAGING_ID
        : name.endsWith("provider-proxy")
          ? PROVIDER_PROXY_ID
          : CELL_ID;
      const imageLabels = {
        ...this.inheritedImageLabels,
        "io.lifecycle.execution-image.v1.image-id": this.selected.image.imageId,
        "io.lifecycle.execution-image.v1.runner-contract-id": this.selected.image.runnerContractId,
        "io.lifecycle.execution-image.v1.runner-contract-digest": this.selected.image.runnerContractDigest,
        "io.lifecycle.execution-image.v1.runner-implementation-digest": this.selected.image.runnerImplementationDigest,
        "io.lifecycle.execution-image.v1.tool-inventory-digest": this.selected.image.toolInventoryDigest,
        ...(this.selected.image.agentProvider === undefined ? {} : {
          "io.lifecycle.execution-image.v1.codex-version": this.selected.image.agentProvider.codexVersion,
          "io.lifecycle.execution-image.v1.codex-executable-identity":
            this.selected.image.agentProvider.executableIdentity,
          "io.lifecycle.execution-image.v1.adapter-implementation-digest":
            this.selected.image.agentProvider.adapterImplementationDigest,
        }),
      };
      this.containers.set(id, {
        id,
        name,
        arguments: Object.freeze([...arguments_]),
        labels: { ...imageLabels, ...labels(arguments_) },
        networks: new Map(),
        state: "created",
        exitCode: 0,
        oomKilled: false,
        stateError: "",
      });
      const networkName = value(arguments_, "--network");
      if (networkName !== null && networkName !== "none") {
        this.containers.get(id)!.networks.set(networkName, []);
      }
      return this.#result(`${id}\n`);
    }
    if (arguments_[0] === "container" && arguments_[1] === "cp") {
      if (arguments_[2] === "-") {
        if (arguments_[3]?.endsWith(":/tmp")) {
          this.providerArchive = request.stdin === null ? null : Uint8Array.from(request.stdin);
          this.providerReady = true;
        } else {
          this.inputArchive = request.stdin === null ? null : Uint8Array.from(request.stdin);
        }
        return this.#result("");
      }
      return this.#result(this.outputArchive);
    }
    if (arguments_[0] === "container" && arguments_[1] === "inspect") {
      const container = this.containers.get(arguments_[2]!);
      if (container === undefined) return this.#result("", 1);
      const mounts = values(container.arguments, "--mount").map((mount) => {
        const fields = Object.fromEntries(mount.split(",").map((part) => {
          const separator = part.indexOf("=");
          return separator === -1 ? [part, true] : [part.slice(0, separator), part.slice(separator + 1)];
        }));
        return {
          Type: "volume",
          Name: fields.src,
          Destination: fields.dst,
          RW: fields.readonly !== true,
        };
      });
      return this.#result(`${JSON.stringify({
        Id: container.id,
        Image: CONFIGURATION_DIGEST,
        Config: {
          Labels: container.labels,
          User: this.selected.image.nonRootUser,
          Image: this.selected.image.immutableReference,
          Env: values(container.arguments, "--env"),
          Entrypoint: [value(container.arguments, "--entrypoint")],
          Cmd: container.arguments.slice(
            container.arguments.indexOf(this.selected.image.immutableReference) + 1,
          ),
        },
        HostConfig: {
          Privileged: false,
          ReadonlyRootfs: true,
          NetworkMode: value(container.arguments, "--network"),
          PidMode: "",
          RestartPolicy: { Name: "no" },
          LogConfig: { Type: value(container.arguments, "--log-driver") ?? "json-file" },
          Binds: null,
          CapDrop: ["ALL"],
          SecurityOpt: values(container.arguments, "--security-opt"),
          Tmpfs: Object.fromEntries(values(container.arguments, "--tmpfs").map((value) => {
            const separator = value.indexOf(":");
            return [value.slice(0, separator), value.slice(separator + 1)];
          })),
        },
        NetworkSettings: {
          Networks: Object.fromEntries([...container.networks].map(([name, aliases]) => [name, {
            Aliases: aliases.length === 0 ? null : aliases,
            DNSNames: aliases.length === 0 ? null : aliases,
          }])),
        },
        Mounts: mounts,
        State: {
          Running: container.state === "running",
          Status: container.state,
          StartedAt: container.state === "created" ? "0001-01-01T00:00:00Z" : "2026-09-01T00:00:01.000000000Z",
          FinishedAt: container.state === "exited" ? "2026-09-01T00:00:02.000000000Z" : "0001-01-01T00:00:00Z",
          ExitCode: container.exitCode,
          OOMKilled: container.oomKilled,
          Error: container.stateError,
        },
      })}\n`);
    }
    if (arguments_[0] === "container" && arguments_[1] === "rm") {
      const container = this.#container(arguments_.at(-1)!);
      if (container !== undefined) {
        this.containers.delete(container.id);
        for (const network of this.networks.values()) network.containers.delete(container.id);
      }
      return this.#result("");
    }
    if (arguments_[0] === "container" && arguments_[1] === "start") {
      const container = this.#container(arguments_.at(-1)!)!;
      if (container.name.endsWith("provider-state-read")) {
        container.state = "exited";
        if (this.providerCredentialReadFailure) return this.#result("", 1);
        const header = Buffer.alloc(12);
        header.write("LCPCRV1\0", 0, "binary");
        header.writeUInt32BE(this.providerCredentialBytes?.byteLength ?? 0, 8);
        return this.#result(Uint8Array.from(Buffer.concat([header, this.providerCredentialBytes ?? Buffer.alloc(0)])));
      }
      container.state = "running";
      for (const networkName of container.networks.keys()) {
        this.networks.get(networkName)?.containers.add(container.id);
      }
      return this.#result(`${arguments_[2]}\n`);
    }
    if (arguments_[0] === "container" && arguments_[1] === "exec") {
      const selected = this.#container(arguments_.find((argument) =>
        this.#container(argument) !== undefined) ?? "");
      if (selected?.id === PROVIDER_PROXY_ID &&
          arguments_.includes("/tmp/lifecycle-provider-control-ready")) {
        return this.#result("", selected.state === "running" ? 0 : 1);
      }
      if (arguments_.includes("provider-support-receive")) {
        this.providerArchive = request.stdin === null ? null : Uint8Array.from(request.stdin);
        this.providerReady = true;
        return this.#result("");
      }
      return this.#result("", this.providerReady ? 0 : 1);
    }
    if (arguments_[0] === "container" && arguments_[1] === "stop") {
      const container = this.#container(arguments_.at(-1)!)!;
      if (container.id === PROVIDER_PROXY_ID && this.providerContainmentFailure) return this.#result("", 1);
      container.state = "exited";
      container.exitCode = 143;
      for (const network of this.networks.values()) network.containers.delete(container.id);
      return this.#result(`${container.id}\n`);
    }
    if (arguments_[0] === "container" && arguments_[1] === "kill") {
      const container = this.#container(arguments_[2]!)!;
      if (container.id === PROVIDER_PROXY_ID && this.providerContainmentFailure) return this.#result("", 1);
      container.state = "exited";
      for (const network of this.networks.values()) network.containers.delete(container.id);
      return this.#result(`${arguments_[2]}\n`);
    }
    assert.fail(`Unexpected Docker CLI command: ${canonicalJson(arguments_)}`);
  }
}

function inputTransport(selected: Fixture, path = "inputs/check.txt"): FoundationDockerInputSetTransportResolverV1 {
  const bytes = Uint8Array.from(Buffer.from("bounded input\n", "utf8"));
  return Object.freeze({
    async open(specification: FoundationExecutionSpecificationV1) {
      assert.equal(specification.digest, selected.specification.digest);
      return Object.freeze({
        inputSet: selected.inputSet,
        inputSetDigest: selected.specification.inputSet.digest,
        async *entries() {
          yield Object.freeze({
            path,
            byteLength: bytes.byteLength,
            digest: sha256Bytes(bytes),
            modeClass: "regular" as const,
            async *read() { yield Uint8Array.from(bytes); },
          });
        },
      });
    },
  });
}

function providerSupport(selected: Fixture): FoundationDockerAgentProviderSupportResolverV1 {
  assert.equal(selected.specification.operation.kind, "agent-attempt");
  assert.notEqual(selected.image.agentProvider, undefined);
  let claimed = false;
  let settled = false;
  return Object.freeze({
    installation: Object.freeze({
      providerDescriptorDigest: selected.specification.operation.providerDescriptorDigest,
      adapterImplementationDigest: selected.specification.operation.adapterImplementationDigest,
      executableIdentity: selected.image.agentProvider!.executableIdentity,
      codexVersion: selected.image.agentProvider!.codexVersion,
      model: "gpt-5.6-sol",
      reasoning: "high",
    }),
    async claimCredential() { claimed = true; },
    async hasCredentialClaim() { return claimed; },
    async credentialSettlement() { return settled; },
    async settleCredential() { settled = true; claimed = false; },
    async forgetCredentialSettlement() { settled = false; },
    async openCredential(
      input: Parameters<FoundationDockerAgentProviderSupportResolverV1["openCredential"]>[0],
    ) {
      assert.equal(input.subject.specificationDigest, selected.specification.digest);
      assert.deepEqual(input.credentialBinding, selected.specification.credentialPolicy.bindings[0]);
      return Object.freeze({
        byteLength: AUTH_BYTES.byteLength,
        async *read() { yield Uint8Array.from(AUTH_BYTES); },
      });
    },
  });
}

function sequenceOwner(): FoundationDockerObservationSequenceV1 {
  let sequence = 0;
  return Object.freeze({ async next() { sequence += 1; return sequence; } });
}

test("Docker CLI driver binds one explicit Engine and immutable runner image without a shell", async () => {
  const selected = fixture();
  const commandExecutor = new FakeDockerCli(selected);
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile,
    dockerExecutable: EXECUTABLE,
    dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT,
    dockerConfigDirectory: "/private/docker-config",
    images: [selected.image],
    inputTransport: inputTransport(selected),
    agentProviderSupport: providerSupport(selected),
    observationSequence: sequenceOwner(),
    commandExecutor,
  });
  const engine = await driver.describe();
  assert.equal(engine.compatibleVersion, "1.48");
  assert.equal(engine.platform.architecture, "amd64");
  const image = await driver.inspectImage({
    imageId: selected.image.imageId,
    imageDigest: selected.image.imageDigest,
    runnerContractId: selected.image.runnerContractId,
    runnerContractDigest: selected.image.runnerContractDigest,
  });
  assert.equal(image.immutableReference, true);
  assert.equal(image.runnerAndToolInventoryVerified, true);
  assert.equal(commandExecutor.requests.every(({ arguments: args }) =>
    args[0] === "--host" && args[1] === ENDPOINT
  ), true);
  assert.equal(commandExecutor.requests.every(({ environment }) =>
    environment.DOCKER_HOST === undefined && environment.DOCKER_API_VERSION === "1.48"
  ), true);
});

test("Docker archive transport preserves long retained paths through the 4096-byte logical bound", async () => {
  const maximumPath = `inputs/${"s/".repeat(2000)}${"x".repeat(89)}`;
  assert.equal(Buffer.byteLength(maximumPath), 4096);
  for (const path of [`inputs/${"x".repeat(107)}`, maximumPath, `${maximumPath}x`]) {
    const selected = fixture();
    const commandExecutor = new FakeDockerCli(selected);
    const driver = await createFoundationDockerCliEngineDriverForTestingV1({
      profile: selected.profile, dockerExecutable: EXECUTABLE, dockerExecutableDigest: digest("docker-executable"),
      engineEndpoint: ENDPOINT, dockerConfigDirectory: "/private/docker-config", images: [selected.image],
      inputTransport: inputTransport(selected, path), agentProviderSupport: providerSupport(selected),
      observationSequence: sequenceOwner(), commandExecutor,
    });
    if (Buffer.byteLength(path) > 4096) {
      await assert.rejects(() => driver.createCell(selected.request), (error: unknown) =>
        error instanceof FoundationError && error.code === "lifecycle.execution.docker-cli-driver.transport");
      assert.equal(commandExecutor.containers.size, 0);
      assert.equal(commandExecutor.volumes.size, 0);
      continue;
    }
    await driver.createCell(selected.request);
    assert(commandExecutor.inputArchive !== null);
    const archive = Buffer.from(commandExecutor.inputArchive);
    assert(archive.includes(Buffer.from(` path=${path}\n`)), "Exact long input identity is carried by a PAX path record");
    assert(archive.includes(Buffer.from("bounded input\n")), "Exact input bytes remain present");
    if (path === maximumPath) assert(archive.includes(Buffer.from(`4107 path=${path}\n`)));
  }
});

test("Docker output transport accepts exact bounded PAX paths and refuses malformed extensions", async () => {
  const selected = fixture();
  const commandExecutor = new FakeDockerCli(selected);
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile, dockerExecutable: EXECUTABLE, dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT, dockerConfigDirectory: "/private/docker-config", images: [selected.image],
    inputTransport: inputTransport(selected), agentProviderSupport: providerSupport(selected),
    observationSequence: sequenceOwner(), commandExecutor,
  });
  await driver.createCell(selected.request);
  const path = `outputs/${"s/".repeat(2000)}${"x".repeat(88)}`;
  assert.equal(Buffer.byteLength(path), 4096);
  const exactRecord = `4107 path=${path}\n`;
  const retrievalInput = {
    cellId: CELL_ID, specificationDigest: selected.specification.digest, inputSetDigest: selected.specification.inputSet.digest,
    imageDigest: selected.specification.image.imageDigest, outputContractDigest: selected.specification.outputContract.digest,
    runnerContractDigest: selected.specification.runner.contractDigest, maximumEntries: selected.specification.limits.outputEntries,
    maximumBytes: selected.specification.limits.outputBytes, maximumEntryBytes: selected.specification.limits.outputEntryBytes,
  };
  commandExecutor.outputArchive = outputArchive(selected, path, Buffer.from(exactRecord));
  const result = await driver.retrieveOutput(retrievalInput);
  assert.equal(result.disposition, "complete");
  assert(result.disposition === "complete");
  const readers = [];
  for await (const reader of result.output.entries()) readers.push(reader);
  assert.deepEqual(readers.map(({ path }) => path), ["outputs/empty.txt", path]);
  for (const invalid of [`4106 path=${path}\n`, `${exactRecord}${exactRecord}`, `4108 path=${path}x\n`, "15 path=../bad\n"]) {
    commandExecutor.outputArchive = outputArchive(selected, path, Buffer.from(invalid));
    const refused = await driver.retrieveOutput(retrievalInput);
    assert.equal(refused.disposition, "unavailable");
    assert.equal(refused.unavailableReason, "partial");
  }
});

test("Docker staging accepts exact inherited image labels and retains substituted resources", async () => {
  for (const key of ["io.lifecycle.execution-driver.v1.specification-digest", "org.opencontainers.image.source", "unexpected.label"]) {
    const selected = fixture();
    const commandExecutor = new FakeDockerCli(selected);
    const execute = commandExecutor.execute.bind(commandExecutor);
    commandExecutor.execute = async (request) => {
      const result = await execute(request);
      const args = request.arguments.slice(2);
      if (args[0] === "container" && args[1] === "cp" && args[2] === "-") {
        commandExecutor.containers.get(STAGING_ID)!.labels[key] = "substituted";
      }
      return result;
    };
    const driver = await createFoundationDockerCliEngineDriverForTestingV1({
      profile: selected.profile, dockerExecutable: EXECUTABLE, dockerExecutableDigest: digest("docker-executable"),
      engineEndpoint: ENDPOINT, dockerConfigDirectory: "/private/docker-config", images: [selected.image],
      inputTransport: inputTransport(selected), agentProviderSupport: providerSupport(selected),
      observationSequence: sequenceOwner(), commandExecutor,
    });
    await assert.rejects(() => driver.createCell(selected.request), (error: unknown) =>
      error instanceof FoundationError && error.code === "lifecycle.execution.docker-cli-driver.staging-integrity");
    assert.equal(commandExecutor.containers.has(STAGING_ID), true, "Substituted staging custody is retained");
    assert.equal(commandExecutor.containers.has(CELL_ID), false);
  }
});

test("Docker CLI driver creates a path-free hardened Cell and consumes dispatch once", async () => {
  const selected = fixture();
  const commandExecutor = new FakeDockerCli(selected);
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile,
    dockerExecutable: EXECUTABLE,
    dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT,
    dockerConfigDirectory: "/private/docker-config",
    images: [selected.image],
    inputTransport: inputTransport(selected),
    agentProviderSupport: providerSupport(selected),
    observationSequence: sequenceOwner(),
    commandExecutor,
    now: () => "2026-09-01T00:00:03.000Z",
  });
  await driver.createCell(selected.request);
  assert.notEqual(commandExecutor.inputArchive, null);
  const inputArchive = Buffer.from(commandExecutor.inputArchive!);
  assert.equal(inputArchive.includes(Buffer.from(".lifecycle/specification.json\0", "utf8")), true);
  assert.equal(inputArchive.includes(Buffer.from(".lifecycle/input-set.json\0", "utf8")), true);
  const cell = commandExecutor.containers.get(CELL_ID)!;
  assert.notEqual(cell, undefined);
  assert.equal(cell.labels["org.opencontainers.image.source"], commandExecutor.inheritedImageLabels["org.opencontainers.image.source"]);
  assert.equal(cell.arguments.includes("--read-only"), true);
  assert.deepEqual(values(cell.arguments, "--cap-drop"), ["ALL"]);
  assert.deepEqual(values(cell.arguments, "--security-opt"), [
    "no-new-privileges",
    "seccomp=unconfined",
  ]);
  const providerNetwork = values(cell.arguments, "--network")[0];
  assert.equal(providerNetwork?.endsWith("-provider-net"), true);
  assert.equal(commandExecutor.networks.get(providerNetwork!)?.internal, true);
  const proxy = commandExecutor.containers.get(PROVIDER_PROXY_ID);
  assert.notEqual(proxy, undefined);
  assert.deepEqual(values(proxy!.arguments, "--network"), ["bridge"]);
  assert.deepEqual(values(cell.arguments, "--env"), [
    "HTTP_PROXY=http://provider-control:18080",
    "HTTPS_PROXY=http://provider-control:18080",
    "http_proxy=http://provider-control:18080",
    "https_proxy=http://provider-control:18080",
  ]);
  assert.deepEqual(values(cell.arguments, "--tmpfs"), [
    `/tmp:rw,exec,nosuid,nodev,size=${selected.specification.limits.storageBytes}`,
  ]);
  assert.equal(cell.arguments.some((argument) => argument.includes("/private/docker.sock")), false);
  assert.equal(cell.arguments.some((argument) => argument.startsWith("type=bind")), false);
  assert.equal(await driver.consumeDispatch(CELL_ID), "consumed");
  assert.equal(await driver.consumeDispatch(CELL_ID), "already-consumed");
  await driver.startCell(CELL_ID);
  assert.equal(commandExecutor.containers.get(PROVIDER_PROXY_ID)?.state, "running");
  assert.notEqual(commandExecutor.providerArchive, null);
  assert.equal(Buffer.from(commandExecutor.providerArchive!).includes(Buffer.from(AUTH_BYTES)), true);
  assert.equal(commandExecutor.requests.some(({ arguments: args, environment }) =>
    canonicalJson({ args, environment }).includes("private-test-token")
  ), false);
  const running = await driver.inspectCell(CELL_ID);
  assert.equal(running?.direct.processState, "running");
  assert.equal(running?.direct.dispatchMarker, "consumed");
  await driver.cancelCell(CELL_ID);
  assert.equal(commandExecutor.containers.get(PROVIDER_PROXY_ID)?.state, "exited");
  commandExecutor.outputArchive = outputArchive(selected);
  const terminal = await driver.inspectCell(CELL_ID);
  assert.equal(terminal?.direct.processState, "terminal");
  assert.equal(terminal?.direct.terminal?.reason, "cancelled");
  assert.equal(terminal?.direct.output.disposition, "complete");
  const retrieval = await driver.retrieveOutput({
    cellId: CELL_ID,
    specificationDigest: selected.specification.digest,
    inputSetDigest: selected.specification.inputSet.digest,
    imageDigest: selected.specification.image.imageDigest,
    outputContractDigest: selected.specification.outputContract.digest,
    runnerContractDigest: selected.specification.runner.contractDigest,
    maximumEntries: selected.specification.limits.outputEntries,
    maximumBytes: selected.specification.limits.outputBytes,
    maximumEntryBytes: selected.specification.limits.outputEntryBytes,
  });
  assert.equal(retrieval.disposition, "complete");
  if (retrieval.disposition !== "complete") assert.fail("Expected complete output retrieval");
  const readers = [];
  for await (const reader of retrieval.output.entries()) readers.push(reader);
  assert.deepEqual(readers.map(({ path }) => path), [
    "outputs/empty.txt",
    "outputs/result.txt",
  ]);
  const emptyChunks = [];
  for await (const chunk of readers[0]!.read()) emptyChunks.push(chunk);
  assert.deepEqual(emptyChunks, []);
  const resultChunks = [];
  for await (const chunk of readers[1]!.read()) resultChunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(resultChunks).toString("utf8"), "bounded output\n");
  commandExecutor.remainingVolumeRemovals = 1;
  assert.equal(await driver.removeCell({
    cellId: CELL_ID,
    specificationDigest: selected.specification.digest,
  }), "remaining");
  assert.equal(commandExecutor.containers.size, 0);
  assert.equal(commandExecutor.networks.size, 0);
  const retainedReclamation = await driver.inspectCell(CELL_ID);
  assert.equal(retainedReclamation?.direct.processState, "terminal");
  assert.equal(await driver.removeCell({
    cellId: CELL_ID,
    specificationDigest: selected.specification.digest,
  }), "removed");
  assert.equal(commandExecutor.containers.size, 0);
  assert.equal(commandExecutor.volumes.size, 0);
});

test("Docker identity discovery stays fresh without repeating physical Cell inspection and retains exact reclamation anchors", async () => {
  const selected = fixture();
  const commandExecutor = new FakeDockerCli(selected);
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile, dockerExecutable: EXECUTABLE, dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT, dockerConfigDirectory: "/private/docker-config", images: [selected.image],
    inputTransport: inputTransport(selected), agentProviderSupport: providerSupport(selected),
    observationSequence: sequenceOwner(), commandExecutor, now: () => "2026-09-01T00:00:03.000Z",
  });
  await driver.createCell(selected.request);
  const selectors = ["allocation-key-digest", "specification-digest"].map((suffix) => ({
    labels: { "io.lifecycle.execution-cell.v1.owner": "lifecycle-runtime",
      [`io.lifecycle.execution-cell.v1.${suffix}`]: selected.request.labels[`io.lifecycle.execution-cell.v1.${suffix}`]! },
    maximumResults: 2 as const,
  }));
  const physical = await driver.inspectCell(CELL_ID);
  assert.equal(physical?.direct.processState, "not-started");
  const before = commandExecutor.requests.length;
  for (const selector of selectors) {
    assert.deepEqual(await driver.findCellIdentities!(selector), { cellIds: [CELL_ID], truncated: false });
  }
  assert.deepEqual(commandExecutor.requests.slice(before).map(({ arguments: args }) => args.slice(2, 4)), [
    ["container", "ls"], ["volume", "ls"], ["container", "ls"], ["volume", "ls"],
  ]);
  const cell = commandExecutor.containers.get(CELL_ID)!;
  const otherId = "d".repeat(64);
  commandExecutor.containers.set(otherId, { ...cell, id: otherId, name: "duplicate-cell" });
  assert.deepEqual(await driver.findCellIdentities!(selectors[0]!), { cellIds: [CELL_ID, otherId], truncated: false });
  commandExecutor.containers.get(otherId)!.labels = { ...cell.labels,
    "io.lifecycle.execution-cell.v1.allocation-key-digest": digest("another-allocation") };
  assert.deepEqual(await driver.findCellIdentities!(selectors[0]!), { cellIds: [CELL_ID], truncated: false });
  assert.deepEqual(await driver.findCellIdentities!(selectors[1]!), { cellIds: [CELL_ID, otherId], truncated: false });
  commandExecutor.containers.delete(otherId);

  await driver.consumeDispatch(CELL_ID);
  await driver.startCell(CELL_ID);
  await driver.cancelCell(CELL_ID);
  commandExecutor.outputArchive = outputArchive(selected);
  commandExecutor.remainingVolumeRemovals = 1;
  assert.equal(await driver.removeCell({ cellId: CELL_ID, specificationDigest: selected.specification.digest }), "remaining");
  assert.equal(commandExecutor.containers.size, 0);
  const anchorName = `lifecycle-reclamation-${CELL_ID}`;
  const anchor = commandExecutor.volumes.get(anchorName)!;
  assert(anchor !== undefined);
  const anchorStart = commandExecutor.requests.length;
  for (const selector of selectors) {
    assert.deepEqual(await driver.findCellIdentities!(selector), { cellIds: [CELL_ID], truncated: false });
  }
  assert(commandExecutor.requests.slice(anchorStart).every(({ arguments: args }) =>
    (args[2] === "container" && args[3] === "ls") ||
    (args[2] === "volume" && (args[3] === "ls" || args[3] === "inspect"))));
  // A Cell and its retained anchor denote the same allocation, not two Cells.
  commandExecutor.containers.set(CELL_ID, cell);
  assert.deepEqual(await driver.findCellIdentities!(selectors[0]!), { cellIds: [CELL_ID], truncated: false });
  commandExecutor.containers.delete(CELL_ID);
  const digestKey = "io.lifecycle.execution-driver.v1.reclamation-inspection-digest";
  commandExecutor.volumes.set(anchorName, { ...anchor, [digestKey]: digest("substituted-inspection") });
  await assert.rejects(driver.findCellIdentities!(selectors[0]!), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.execution.docker-cli-driver.reclamation-anchor");
  commandExecutor.volumes.delete(anchorName);
  commandExecutor.volumes.set(`${anchorName}-alias`, anchor);
  await assert.rejects(driver.findCellIdentities!(selectors[0]!), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.execution.docker-cli-driver.reclamation-anchor");
  commandExecutor.volumes.delete(`${anchorName}-alias`);
  commandExecutor.volumes.set(anchorName, anchor);
  assert.deepEqual(await driver.findCellIdentities!(selectors[0]!), { cellIds: [CELL_ID], truncated: false });
});

test("Docker identity discovery refuses malformed and unavailable lists and marks over-bound results", async () => {
  const selected = fixture();
  const backing = new FakeDockerCli(selected);
  let replacement: string | Error | null = null;
  const commandExecutor: FoundationDockerCliCommandExecutorV1 = {
    execute: async (request) => {
      if (replacement !== null && request.arguments[2] === "container" && request.arguments[3] === "ls") {
        if (replacement instanceof Error) throw replacement;
        return { exitCode: 0, signal: null, stdout: Uint8Array.from(Buffer.from(replacement)), stderrTruncated: false };
      }
      return await backing.execute(request);
    },
  };
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile, dockerExecutable: EXECUTABLE, dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT, dockerConfigDirectory: "/private/docker-config", images: [selected.image],
    inputTransport: inputTransport(selected), observationSequence: sequenceOwner(), commandExecutor,
  });
  const selector = { labels: { "io.lifecycle.execution-cell.v1.owner": "lifecycle-runtime" }, maximumResults: 2 as const };
  for (const value of ["short-id\n", `${CELL_ID}extra\n`, new Error("unavailable identity observation")]) {
    replacement = value;
    await assert.rejects(driver.findCellIdentities!(selector));
  }
  for (const value of [`${CELL_ID}\n${CELL_ID}\n`, `${CELL_ID}\n${"d".repeat(64)}\n${"e".repeat(64)}\n`]) {
    replacement = value;
    assert.equal((await driver.findCellIdentities!(selector)).truncated, true);
  }
  replacement = null;
  assert.deepEqual(await driver.findCellIdentities!(selector), { cellIds: [], truncated: false });
});

test("Docker CLI driver preserves an unknown runner terminal while containing its surviving provider proxy", async () => {
  const selected = fixture();
  const commandExecutor = new FakeDockerCli(selected);
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile,
    dockerExecutable: EXECUTABLE,
    dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT,
    dockerConfigDirectory: "/private/docker-config",
    images: [selected.image],
    inputTransport: inputTransport(selected),
    agentProviderSupport: providerSupport(selected),
    observationSequence: sequenceOwner(),
    commandExecutor,
  });
  await driver.createCell(selected.request);
  assert.equal(await driver.consumeDispatch(CELL_ID), "consumed");
  await driver.startCell(CELL_ID);
  assert.equal(commandExecutor.containers.get(PROVIDER_PROXY_ID)?.state, "running");
  const cell = commandExecutor.containers.get(CELL_ID)!;
  cell.state = "exited";
  cell.exitCode = 137;

  const lostParent = await driver.inspectCell(CELL_ID);
  assert.equal(lostParent?.direct.processState, "terminal");
  assert.equal(lostParent?.direct.containmentFacts.descendants, "present");
  assert.equal(lostParent?.direct.containmentFacts.writers, "present");
  assert.deepEqual(lostParent?.direct.terminal, {
    finishedAt: "2026-09-01T00:00:02.000Z",
    reason: "unknown",
    exitCode: 137,
    signal: null,
    runnerDisposition: "unavailable",
  });
  assert.equal(lostParent?.direct.output.disposition, "missing");

  await driver.cancelCell(CELL_ID);
  assert.equal(commandExecutor.volumes.has(`lifecycle-cancel-${CELL_ID}`), false);
  assert.equal(commandExecutor.containers.get(PROVIDER_PROXY_ID)?.state, "exited");
  const contained = await driver.inspectCell(CELL_ID);
  assert.deepEqual(contained?.direct.terminal, lostParent?.direct.terminal);
  assert.equal(contained?.direct.containmentFacts.descendants, "absent");
  assert.equal(contained?.direct.containmentFacts.writers, "absent");
  assert.equal(contained?.direct.containmentFacts.credentials, "revoked");
  assert.equal(contained?.direct.containmentFacts.providerChannel, "unreachable");
  assert.equal(contained?.direct.containmentFacts.outputMutation, "impossible");

  const substitutedArguments = [...cell.arguments];
  substitutedArguments[substitutedArguments.indexOf("--entrypoint") + 1] = "/bin/sh";
  cell.arguments = Object.freeze(substitutedArguments);
  await assert.rejects(driver.inspectCell(CELL_ID), (error: unknown) =>
    error instanceof FoundationError &&
    error.code === "lifecycle.execution.docker-cli-driver.cell-integrity");
});

test("Docker CLI observation reopens one mixed terminal network read without relaxing exact integrity", async () => {
  for (const scenario of ["terminal-detachment", "missing-cell", "missing-proxy", "unexpected-member", "changed-configuration", "changed-proxy-configuration"] as const) {
    const selected = fixture();
    const fake = new FakeDockerCli(selected);
    let changeAtNetworkRead: (() => void) | null = null;
    const commandExecutor: FoundationDockerCliCommandExecutorV1 = {
      async execute(request) {
        if (request.arguments[2] === "network" && request.arguments[3] === "inspect" && changeAtNetworkRead !== null) {
          const change = changeAtNetworkRead;
          changeAtNetworkRead = null;
          change();
        }
        return await fake.execute(request);
      },
    };
    const driver = await createFoundationDockerCliEngineDriverForTestingV1({
      profile: selected.profile, dockerExecutable: EXECUTABLE,
      dockerExecutableDigest: digest("docker-executable"), engineEndpoint: ENDPOINT,
      dockerConfigDirectory: "/private/docker-config", images: [selected.image],
      inputTransport: inputTransport(selected), agentProviderSupport: providerSupport(selected),
      observationSequence: sequenceOwner(), commandExecutor,
    });
    await driver.createCell(selected.request);
    assert.equal(await driver.consumeDispatch(CELL_ID), "consumed");
    await driver.startCell(CELL_ID);
    const before = await driver.inspectCell(CELL_ID);
    assert.equal(before?.direct.processState, "running");
    const cell = fake.containers.get(CELL_ID)!;
    const network = [...fake.networks.values()].find((value) => value.internal)!;
    changeAtNetworkRead = () => {
      if (scenario === "unexpected-member") { network.containers.add("f".repeat(64)); return; }
      network.containers.delete(scenario === "missing-proxy" ? PROVIDER_PROXY_ID : CELL_ID);
      if (scenario === "terminal-detachment" || scenario === "changed-configuration" || scenario === "changed-proxy-configuration") {
        cell.state = "exited";
        cell.exitCode = 0;
      }
      if (scenario === "changed-configuration" || scenario === "changed-proxy-configuration") {
        const changed = scenario === "changed-configuration" ? cell : fake.containers.get(PROVIDER_PROXY_ID)!;
        const arguments_ = [...changed.arguments];
        arguments_[arguments_.indexOf("--entrypoint") + 1] = "/bin/sh";
        changed.arguments = Object.freeze(arguments_);
      }
    };
    const requestStart = fake.requests.length;
    if (scenario === "terminal-detachment") {
      const terminal = await driver.inspectCell(CELL_ID);
      assert.equal(terminal?.cellId, CELL_ID);
      assert.equal(terminal?.direct.processState, "terminal");
      assert.equal(terminal?.direct.observationSequence, before!.direct.observationSequence + 1,
        "the discarded mixed read publishes no observation sequence");
      assert.equal(terminal?.direct.containmentFacts.descendants, "present",
        "the surviving exact proxy still needs containment");
    } else {
      await assert.rejects(driver.inspectCell(CELL_ID), (error: unknown) => error instanceof FoundationError &&
        error.code === `lifecycle.execution.docker-cli-driver.${scenario === "changed-configuration" ? "cell-integrity" : "provider-channel-integrity"}`, scenario);
    }
    const readRequests = fake.requests.slice(requestStart);
    assert.equal(readRequests.filter(({ arguments: args }) => args[2] === "container" && args[3] === "inspect" && args[4] === CELL_ID).length,
      scenario === "unexpected-member" ? 1 : 2, scenario);
    assert.equal(readRequests.some(({ arguments: args }) => ["create", "start", "stop", "kill", "rm", "connect"].includes(args[3]!)), false,
      "reobservation performs no resource mutation or redispatch");
    if (scenario === "terminal-detachment") {
      await driver.cancelCell(CELL_ID);
      const contained = await driver.inspectCell(CELL_ID);
      assert.equal(contained?.direct.processState, "terminal");
      assert.equal(contained?.direct.terminal?.exitCode, 0);
      assert.equal(contained?.direct.containmentFacts.descendants, "absent");
      assert.equal(contained?.direct.containmentFacts.writers, "absent");
      assert.equal(contained?.direct.containmentFacts.credentials, "revoked");
      assert.equal(contained?.direct.containmentFacts.providerChannel, "unreachable");
      assert.equal(contained?.direct.containmentFacts.outputMutation, "impossible");
      assert.equal(await driver.consumeDispatch(CELL_ID), "already-consumed");
    }
  }
});

test("Docker CLI driver distinguishes an OOM backend failure from an otherwise unknown runner exit", async () => {
  const selected = fixture();
  const commandExecutor = new FakeDockerCli(selected);
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile,
    dockerExecutable: EXECUTABLE,
    dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT,
    dockerConfigDirectory: "/private/docker-config",
    images: [selected.image],
    inputTransport: inputTransport(selected),
    agentProviderSupport: providerSupport(selected),
    observationSequence: sequenceOwner(),
    commandExecutor,
  });
  await driver.createCell(selected.request);
  assert.equal(await driver.consumeDispatch(CELL_ID), "consumed");
  await driver.startCell(CELL_ID);
  const cell = commandExecutor.containers.get(CELL_ID)!;
  cell.state = "exited";
  cell.exitCode = 137;
  cell.oomKilled = true;

  const observation = await driver.inspectCell(CELL_ID);
  assert.equal(observation?.direct.terminal?.reason, "backend-failure");
  assert.equal(observation?.direct.terminal?.signal, null);
  assert.equal(observation?.direct.terminal?.runnerDisposition, "unavailable");
});

test("Docker CLI Reclamation removes an exact orphan dispatch marker idempotently and refuses substitution or ambiguity", async () => {
  const selected = fixture();
  const commandExecutor = new FakeDockerCli(selected);
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile,
    dockerExecutable: EXECUTABLE,
    dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT,
    dockerConfigDirectory: "/private/docker-config",
    images: [selected.image],
    inputTransport: inputTransport(selected),
    agentProviderSupport: providerSupport(selected),
    observationSequence: sequenceOwner(),
    commandExecutor,
  });
  const markerName = `lifecycle-dispatch-${CELL_ID}`;

  const leaveOnlyDispatchMarker = async (): Promise<Record<string, string>> => {
    await driver.createCell(selected.request);
    assert.equal(await driver.consumeDispatch(CELL_ID), "consumed");
    const markerLabels = commandExecutor.volumes.get(markerName);
    assert.notEqual(markerLabels, undefined);
    commandExecutor.containers.clear();
    commandExecutor.networks.clear();
    for (const name of [...commandExecutor.volumes.keys()]) {
      if (name !== markerName) commandExecutor.volumes.delete(name);
    }
    return { ...markerLabels! };
  };

  const exactLabels = await leaveOnlyDispatchMarker();
  assert.equal(await driver.removeCell({
    cellId: CELL_ID,
    specificationDigest: selected.specification.digest,
  }), "removed");
  assert.equal(commandExecutor.volumes.size, 0);
  assert.equal(await driver.removeCell({
    cellId: CELL_ID,
    specificationDigest: selected.specification.digest,
  }), "missing");

  await leaveOnlyDispatchMarker();
  commandExecutor.volumes.set(markerName, {
    ...exactLabels,
    "io.lifecycle.execution-driver.v1.specification-digest": digest("substituted-specification"),
  });
  assert.equal(await driver.removeCell({
    cellId: CELL_ID,
    specificationDigest: selected.specification.digest,
  }), "integrity-refusal");
  assert.equal(commandExecutor.volumes.has(markerName), true);

  commandExecutor.volumes.set(markerName, exactLabels);
  commandExecutor.volumes.set(`${markerName}-duplicate`, { ...exactLabels });
  assert.equal(await driver.removeCell({
    cellId: CELL_ID,
    specificationDigest: selected.specification.digest,
  }), "integrity-refusal");
  assert.equal(commandExecutor.volumes.has(markerName), true);
  assert.equal(commandExecutor.volumes.has(`${markerName}-duplicate`), true);
});

test("Docker production profile and driver refuse unimplemented Agent policy modes", async () => {
  const selected = fixture();
  assert.deepEqual(selected.profile.networkPolicy.agentProductNetworkModes, ["none"]);
  assert.deepEqual(selected.profile.credentialPolicy.injectionModes, ["none", "fixed-runner"]);
  const commandExecutor = new FakeDockerCli(selected);
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile,
    dockerExecutable: EXECUTABLE,
    dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT,
    dockerConfigDirectory: "/private/docker-config",
    images: [selected.image],
    inputTransport: inputTransport(selected),
    agentProviderSupport: providerSupport(selected),
    observationSequence: sequenceOwner(),
    commandExecutor,
  });
  const { digest: _networkDigest, ...networkSpecification } = selected.specification;
  const substitutedNetwork = Object.freeze({
    ...networkSpecification,
    networkPolicy: Object.freeze({
      ...selected.specification.networkPolicy,
      agentProductNetwork: "loopback" as const,
    }),
  });
  await assert.rejects(driver.createCell(Object.freeze({
    ...selected.request,
    specification: Object.freeze({
      ...substitutedNetwork,
      digest: selfDigest(substitutedNetwork),
    }) as FoundationExecutionSpecificationV1,
  })), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.execution.docker-cli-driver.unsupported");

  const { digest: _credentialDigest, ...credentialSpecification } = selected.specification;
  const substitutedCredential = Object.freeze({
    ...credentialSpecification,
    credentialPolicy: Object.freeze({
      ...selected.specification.credentialPolicy,
      mode: "isolated-broker" as const,
    }),
  });
  await assert.rejects(driver.createCell(Object.freeze({
    ...selected.request,
    specification: Object.freeze({
      ...substitutedCredential,
      digest: selfDigest(substitutedCredential),
    }) as FoundationExecutionSpecificationV1,
  })), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.execution.docker-cli-driver.provider-support");
});

test("allocation absence excludes exact and renamed provisional resources without modifying them", async () => {
  const selected = fixture();
  const allocationName = selected.request.allocationName;
  const cases: { kind: "container" | "volume" | "network"; name: string; labels: Record<string, string>; expected: boolean }[] = [
    { kind: "container", name: allocationName, labels: {}, expected: false },
    { kind: "container", name: `${allocationName}-input-stage`, labels: {}, expected: false },
    { kind: "container", name: `${allocationName}-provider-proxy`, labels: {}, expected: false },
    { kind: "volume", name: `${allocationName}-input`, labels: {}, expected: false },
    { kind: "volume", name: `${allocationName}-output`, labels: {}, expected: false },
    { kind: "volume", name: `${allocationName}-provider-state`, labels: {}, expected: false },
    { kind: "container", name: `${allocationName}-provider-state-read`, labels: {}, expected: false },
    { kind: "network", name: `${allocationName}-provider-net`, labels: {}, expected: false },
    { kind: "volume", name: "unrelated-allocation", labels: { "io.lifecycle.execution-driver.v1.specification-digest": digest("another-specification") }, expected: true },
  ];
  for (const kind of ["container", "volume", "network"] as const) {
    for (const [label, subject] of [
      ["io.lifecycle.execution-driver.v1.allocation-name", allocationName],
      ["io.lifecycle.execution-driver.v1.specification-digest", selected.specification.digest],
      ["io.lifecycle.execution-cell.v1.specification-digest", selected.specification.digest],
    ]) cases.push({ kind, name: "renamed-provisional-resource", labels: { [label!]: subject! }, expected: false });
  }
  for (const variation of cases) {
    const commandExecutor = new FakeDockerCli(selected);
    const driver = await createFoundationDockerCliEngineDriverForTestingV1({
      profile: selected.profile, dockerExecutable: EXECUTABLE, dockerExecutableDigest: digest("docker-executable"),
      engineEndpoint: ENDPOINT, dockerConfigDirectory: "/private/docker-config", images: [selected.image],
      inputTransport: inputTransport(selected), agentProviderSupport: providerSupport(selected),
      observationSequence: sequenceOwner(), commandExecutor,
    });
    assert.equal(await driver.allocationResourcesAbsent!({ allocationName, specificationDigest: selected.specification.digest }), true);
    if (variation.kind === "container") commandExecutor.containers.set(CELL_ID, {
      id: CELL_ID, name: variation.name, arguments: [], labels: variation.labels, networks: new Map(),
      state: "created", exitCode: 0, oomKilled: false, stateError: "",
    });
    if (variation.kind === "volume") commandExecutor.volumes.set(variation.name, variation.labels);
    if (variation.kind === "network") commandExecutor.networks.set(variation.name, { labels: variation.labels, internal: true, containers: new Set() });
    const before = commandExecutor.requests.length;
    assert.equal(await driver.allocationResourcesAbsent!({ allocationName, specificationDigest: selected.specification.digest }), variation.expected,
      `${variation.kind} ${variation.name} ${canonicalJson(variation.labels)}`);
    assert.equal(commandExecutor.containers.size + commandExecutor.volumes.size + commandExecutor.networks.size, 1);
    assert(commandExecutor.requests.slice(before).every(({ arguments: args, maximumStdoutBytes }) =>
      ["container", "volume", "network"].includes(args[2]!) && args[3] === "ls" && maximumStdoutBytes === 4096));
  }
});

test("allocation absence never converts a failed resource observation into empty discovery", async () => {
  const selected = fixture();
  const backing = new FakeDockerCli(selected);
  let unavailable = true;
  const commandExecutor: FoundationDockerCliCommandExecutorV1 = {
    execute: async (request) => {
      if (unavailable && request.arguments[2] === "network" && request.arguments[3] === "ls") {
        throw new Error("temporary network observation loss");
      }
      return await backing.execute(request);
    },
  };
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile, dockerExecutable: EXECUTABLE, dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT, dockerConfigDirectory: "/private/docker-config", images: [selected.image],
    inputTransport: inputTransport(selected), agentProviderSupport: providerSupport(selected),
    observationSequence: sequenceOwner(), commandExecutor,
  });
  const subject = { allocationName: selected.request.allocationName, specificationDigest: selected.specification.digest };
  await assert.rejects(driver.allocationResourcesAbsent!(subject));
  unavailable = false;
  assert.equal(await driver.allocationResourcesAbsent!(subject), true, "Restored exact observation can establish absence");
});

test("Docker image inspection refuses an Agent adapter identity that is not the fixed runner", async () => {
  const selected = fixture();
  const substitutedImage = Object.freeze({
    ...selected.image,
    agentProvider: Object.freeze({
      ...selected.image.agentProvider!,
      adapterImplementationDigest: digest("substituted-agent-adapter"),
    }),
  });
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile,
    dockerExecutable: EXECUTABLE,
    dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT,
    dockerConfigDirectory: "/private/docker-config",
    images: [substitutedImage],
    inputTransport: inputTransport(selected),
    agentProviderSupport: providerSupport(selected),
    observationSequence: sequenceOwner(),
    commandExecutor: new FakeDockerCli(selected),
  });
  await assert.rejects(driver.inspectImage({
    imageId: substitutedImage.imageId,
    imageDigest: substitutedImage.imageDigest,
    runnerContractId: substitutedImage.runnerContractId,
    runnerContractDigest: substitutedImage.runnerContractDigest,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.execution.docker-cli-driver.image-substitution");
});


test("credential claim precedes Docker allocation and binds dispatch to its retained exact subject", async () => {
  const selected = fixture();
  const commands = new FakeDockerCli(selected);
  const support = providerSupport(selected);
  let claimed: Parameters<FoundationDockerAgentProviderSupportResolverV1["claimCredential"]>[0] | null = null;
  let opened = 0;
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile, dockerExecutable: EXECUTABLE, dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT, dockerConfigDirectory: "/private/docker-config", images: [selected.image],
    inputTransport: inputTransport(selected), observationSequence: sequenceOwner(), commandExecutor: commands,
    agentProviderSupport: { ...support,
      async claimCredential(input) {
        assert.equal(commands.requests.map(({ arguments: args, environment }) => ({ args: args.slice(2), environment })).some(({ args }) => ["create", "rm", "cp", "start", "connect"].includes(args[1] ?? "")), false,
          "Image/input validation may read Docker but claim must precede the first physical mutation");
        claimed = input;
        await support.claimCredential(input);
      },
      async openCredential(input) {
        opened += 1;
        assert.deepEqual(input, claimed);
        return await support.openCredential(input);
      },
    },
  });
  await driver.createCell(selected.request);
  const engine = await driver.describe();
  assert.deepEqual(claimed, { subject: { specificationDigest: selected.specification.digest,
    engineIdentityDigest: engine.engineIdentityDigest, allocationName: selected.request.allocationName },
    credentialBinding: selected.specification.credentialPolicy.bindings[0] });
  assert.equal(opened, 0);
  assert.equal(await driver.consumeDispatch(CELL_ID), "consumed");
  await driver.startCell(CELL_ID);
  assert.equal(opened, 1);
  const cell = commands.containers.get(CELL_ID)!;
  assert.ok(values(cell.arguments, "--mount").includes(`type=volume,src=${selected.request.allocationName}-provider-state,dst=/tmp/lifecycle-provider-state`));
  assert.equal(commands.volumes.get(`${selected.request.allocationName}-provider-state`)?.["io.lifecycle.execution-driver.v1.resource-kind"], "provider-state");
  const originalArguments = cell.arguments;
  cell.arguments = Object.freeze(originalArguments.map((argument) =>
    argument.replace("dst=/tmp/lifecycle-provider-state", "dst=/lifecycle/provider-state")));
  await assert.rejects(() => driver.inspectCell(CELL_ID), /exact hardened configuration/);
  cell.arguments = originalArguments;
  assert.notEqual(await driver.inspectCell(CELL_ID), null,
    "Restoring the selected private volume destination restores exact inspection");
});

test("credential retirement resumes the exact refreshed volume, refuses temporary loss, and never replays settled bytes", async () => {
  for (const missingCell of [false, true]) {
    const selected = fixture();
    const commands = new FakeDockerCli(selected);
    const support = providerSupport(selected);
    const outcomes: string[] = [];
    const updated = Uint8Array.from(Buffer.from('{"tokens":{"refresh_token":"renewed-fixture-only"}}'));
    const driver = await createFoundationDockerCliEngineDriverForTestingV1({
      profile: selected.profile, dockerExecutable: EXECUTABLE, dockerExecutableDigest: digest("docker-executable"),
      engineEndpoint: ENDPOINT, dockerConfigDirectory: "/private/docker-config", images: [selected.image],
      inputTransport: inputTransport(selected), observationSequence: sequenceOwner(), commandExecutor: commands,
      agentProviderSupport: { ...support, async settleCredential(input) {
        outcomes.push(input.outcome.kind);
        assert.equal(input.outcome.kind, "updated");
        if (input.outcome.kind === "updated") assert.deepEqual(input.outcome.bytes, updated);
        await support.settleCredential(input);
      } },
    });
    await driver.createCell(selected.request);
    await driver.consumeDispatch(CELL_ID);
    await driver.startCell(CELL_ID);
    await driver.cancelCell(CELL_ID);
    if (missingCell) commands.containers.delete(CELL_ID);
    commands.providerCredentialBytes = updated;
    commands.providerCredentialReadFailure = true;
    const selection = { specification: selected.specification, allocationName: selected.request.allocationName, cellId: CELL_ID };
    await assert.rejects(driver.settleProviderCredential!(selection), (error: unknown) =>
      error instanceof FoundationError && error.code === "lifecycle.execution.docker-cli-driver.provider-state-read" && error.retryable === true);
    assert.deepEqual(outcomes, []);
    commands.providerCredentialReadFailure = false;
    await driver.settleProviderCredential!(selection);
    assert.deepEqual(outcomes, ["updated"]);
    const reads = commands.requests.map(({ arguments: args, environment }) => ({ args: args.slice(2), environment })).filter(({ args }) => args[0] === "container" && args[1] === "start" && args.includes("--attach")).length;
    commands.providerCredentialBytes = Uint8Array.from(AUTH_BYTES);
    await driver.settleProviderCredential!(selection);
    assert.deepEqual(outcomes, ["updated"]);
    assert.equal(commands.requests.map(({ arguments: args, environment }) => ({ args: args.slice(2), environment })).filter(({ args }) => args[0] === "container" && args[1] === "start" && args.includes("--attach")).length, reads);
    assert.equal(commands.containers.has(PROVIDER_READER_ID), false);
    if (missingCell) {
      assert.equal(await driver.removeCell({ cellId: CELL_ID, specificationDigest: selected.specification.digest,
        allocationName: selected.request.allocationName }), "removed");
      assert.equal(await driver.allocationResourcesAbsent!({ allocationName: selected.request.allocationName,
        specificationDigest: selected.specification.digest }), true);
      assert.equal(commands.volumes.size, 0, "Lost Cell before anchor must not leave its private credential volume behind");
    }
    const helper = commands.requests.map(({ arguments: args, environment }) => ({ args: args.slice(2), environment })).find(({ args }) => args.includes("provider-credential-read"))!;
    assert.equal(value(helper.args, "--log-driver"), "none");
    assert.deepEqual(values(helper.args, "--mount"), [`type=volume,src=${selected.request.allocationName}-provider-state,dst=/tmp/lifecycle-provider-state,readonly`]);
    for (const call of commands.requests.map(({ arguments: args, environment }) => ({ args: args.slice(2), environment }))) assert.equal(canonicalJson({ args: call.args, environment: call.environment }).includes("renewed-fixture-only"), false);
  }
});

test("credential retirement separates authoritative unused, missing state, and absent unclaimed allocation", async () => {
  for (const course of ["unallocated", "unused", "missing-auth", "substituted-volume"] as const) {
    const selected = fixture();
    const commands = new FakeDockerCli(selected);
    const support = providerSupport(selected);
    const outcomes: string[] = [];
    const driver = await createFoundationDockerCliEngineDriverForTestingV1({
      profile: selected.profile, dockerExecutable: EXECUTABLE, dockerExecutableDigest: digest("docker-executable"),
      engineEndpoint: ENDPOINT, dockerConfigDirectory: "/private/docker-config", images: [selected.image],
      inputTransport: inputTransport(selected), observationSequence: sequenceOwner(), commandExecutor: commands,
      agentProviderSupport: { ...support, async settleCredential(input) { outcomes.push(input.outcome.kind); await support.settleCredential(input); } },
    });
    if (course !== "unallocated") await driver.createCell(selected.request);
    if (course === "missing-auth" || course === "substituted-volume") {
      await driver.consumeDispatch(CELL_ID); await driver.startCell(CELL_ID); await driver.cancelCell(CELL_ID);
      commands.providerCredentialBytes = null;
    }
    if (course === "substituted-volume") commands.volumes.get(`${selected.request.allocationName}-provider-state`)!["io.lifecycle.execution-driver.v1.specification-digest"] = digest("substituted");
    const selection = { specification: selected.specification, allocationName: selected.request.allocationName, cellId: course === "unallocated" ? null : CELL_ID };
    if (course === "substituted-volume") await assert.rejects(driver.settleProviderCredential!(selection), /substituted/);
    else await driver.settleProviderCredential!(selection);
    assert.deepEqual(outcomes, course === "unused" ? ["unused"] : course === "missing-auth" ? ["lost"] : []);
    if (course === "unallocated") assert.equal(commands.requests.map(({ arguments: args, environment }) => ({ args: args.slice(2), environment })).some(({ args }) => ["create", "rm", "start"].includes(args[1] ?? "")), false);
  }
});


test("lost Cell recovery contains its exact surviving proxy before credential settlement and Reclamation", async () => {
  const selected = fixture();
  const commands = new FakeDockerCli(selected);
  const support = providerSupport(selected);
  const outcomes: string[] = [];
  const driver = await createFoundationDockerCliEngineDriverForTestingV1({
    profile: selected.profile, dockerExecutable: EXECUTABLE, dockerExecutableDigest: digest("docker-executable"),
    engineEndpoint: ENDPOINT, dockerConfigDirectory: "/private/docker-config", images: [selected.image],
    inputTransport: inputTransport(selected), observationSequence: sequenceOwner(), commandExecutor: commands,
    agentProviderSupport: { ...support, async settleCredential(input) { outcomes.push(input.outcome.kind); await support.settleCredential(input); } },
  });
  await driver.createCell(selected.request);
  await driver.consumeDispatch(CELL_ID);
  await driver.startCell(CELL_ID);
  commands.containers.delete(CELL_ID);
  for (const network of commands.networks.values()) network.containers.delete(CELL_ID);
  commands.providerContainmentFailure = true;
  const selection = { specification: selected.specification, allocationName: selected.request.allocationName, cellId: CELL_ID };
  await assert.rejects(driver.settleProviderCredential!(selection), /provider containment/);
  assert.deepEqual(outcomes, []);
  assert.equal(commands.containers.get(PROVIDER_PROXY_ID)?.state, "running");
  commands.providerContainmentFailure = false;
  await driver.settleProviderCredential!(selection);
  assert.deepEqual(outcomes, ["updated"]);
  assert.equal(commands.containers.get(PROVIDER_PROXY_ID)?.state, "exited");
  assert.equal(await driver.removeCell({ cellId: CELL_ID, specificationDigest: selected.specification.digest,
    allocationName: selected.request.allocationName }), "removed");
  assert.equal(await driver.allocationResourcesAbsent!({ specificationDigest: selected.specification.digest,
    allocationName: selected.request.allocationName }), true);
  const starts = commands.requests.map(({ arguments: args }) => args.slice(2)).filter(args => args[0] === "container" && args[1] === "start" && !args.includes("--attach"));
  assert.equal(starts.filter(args => args.includes(CELL_ID)).length, 1, "Recovery never redispatches the missing productive Cell");
});
