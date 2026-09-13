import { createHash } from "node:crypto";

export const DISTRIBUTION_MANIFEST_SCHEMA = "lifecycle.distribution-manifest.v1" as const;
export const DISTRIBUTION_TEMPLATE_SCHEMA =
  "lifecycle.distribution-manifest-template.private.v1" as const;
export const DISTRIBUTION_SELECTION_SCHEMA =
  "lifecycle.distribution-build-selection.private.v1" as const;
export const RUNTIME_INVOCATION_PROTOCOL = "lifecycle.runtime-invocation.private.v1" as const;
export const RUNTIME_IMAGE_REPOSITORY = "ghcr.io/neutral/lifecycle-runtime" as const;
export const EXECUTION_IMAGE_REPOSITORY = "ghcr.io/neutral/lifecycle-execution" as const;

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const ARCHITECTURES = ["amd64", "arm64"] as const;

export type DistributionArchitecture = typeof ARCHITECTURES[number];

export type DistributionPlatformSelection = Readonly<{
  architecture: DistributionArchitecture;
  configurationDigest: `sha256:${string}`;
  os: "linux";
  variant: null;
}>;

export type DistributionExecutionPlatformSelection = DistributionPlatformSelection & Readonly<{
  codexExecutableDigest: `sha256:${string}`;
  toolInventoryDigest: `sha256:${string}`;
}>;

export type DistributionManifest = Readonly<{
  coordinates: Readonly<{
    interfaceProtocol: "lifecycle.interface.foundation.v17";
    providerAdapter: "lifecycle.provider-adapter.v7";
    qualificationRevision: "lifecycle.foundation.1.0.0-rc.17";
    repositoryContract: "lifecycle.repository.v22";
    runtimeProtocol: "lifecycle.runtime.foundation.v17";
  }>;
  distribution: Readonly<{
    nodeMinimum: "24.14.0";
    npmPackage: "@neutral/lifecycle";
    runtimeInvocationProtocol: typeof RUNTIME_INVOCATION_PROTOCOL;
    sourceRevision: string;
    version: "1.0.0";
  }>;
  images: Readonly<{
    execution: Readonly<{
      agentAdapterImplementationDigest: `sha256:${string}`;
      codexVersion: "0.153.4";
      imageId: string;
      indexDigest: `sha256:${string}`;
      nonRootUser: "65532:65532";
      platforms: readonly DistributionExecutionPlatformSelection[];
      repository: typeof EXECUTION_IMAGE_REPOSITORY;
      runnerContractDigest: `sha256:${string}`;
      runnerContractId: "lifecycle.execution-cell-runner.v1";
      runnerImplementationDigest: `sha256:${string}`;
    }>;
    runtime: Readonly<{
      indexDigest: `sha256:${string}`;
      platforms: readonly DistributionPlatformSelection[];
      repository: typeof RUNTIME_IMAGE_REPOSITORY;
    }>;
  }>;
  schema: typeof DISTRIBUTION_MANIFEST_SCHEMA;
}>;

type JsonObject = Record<string, unknown>;

function fail(message: string): never {
  throw new TypeError(`Lifecycle Distribution Manifest is invalid: ${message}`);
}

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be one object`);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  const observed = Object.keys(value).sort();
  const selected = [...expected].sort();
  if (JSON.stringify(observed) !== JSON.stringify(selected)) {
    fail(`${label} must have exactly ${selected.join(", ")}`);
  }
}

function exactString(value: unknown, expected: string, label: string): void {
  if (value !== expected) fail(`${label} must equal ${expected}`);
}

function digest(value: unknown, label: string): asserts value is `sha256:${string}` {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be one lowercase SHA-256 digest`);
  }
}

function platformArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== 2) {
    fail(`${label} must select exactly amd64 and arm64`);
  }
  return value;
}

function assertOrderedPlatforms(
  output: readonly { architecture: DistributionArchitecture }[],
  label: string,
): void {
  const architectures = output.map(({ architecture }) => architecture);
  if (JSON.stringify(architectures) !== JSON.stringify(ARCHITECTURES)) {
    fail(`${label} must contain exactly one amd64 then one arm64 selection`);
  }
}

function parsePlatforms(value: unknown, label: string): readonly DistributionPlatformSelection[] {
  const output = platformArray(value, label).map((entry, index) => {
    const platform = object(entry, `${label}[${index}]`);
    exactKeys(
      platform,
      ["architecture", "configurationDigest", "os", "variant"],
      `${label}[${index}]`,
    );
    if (!ARCHITECTURES.includes(platform.architecture as DistributionArchitecture)) {
      fail(`${label}[${index}].architecture must be amd64 or arm64`);
    }
    exactString(platform.os, "linux", `${label}[${index}].os`);
    if (platform.variant !== null) fail(`${label}[${index}].variant must be null`);
    digest(platform.configurationDigest, `${label}[${index}].configurationDigest`);
    return Object.freeze({
      architecture: platform.architecture as DistributionArchitecture,
      configurationDigest: platform.configurationDigest,
      os: "linux" as const,
      variant: null,
    });
  });
  assertOrderedPlatforms(output, label);
  return Object.freeze(output);
}

function parseExecutionPlatforms(
  value: unknown,
  label: string,
): readonly DistributionExecutionPlatformSelection[] {
  const output = platformArray(value, label).map((entry, index) => {
    const platform = object(entry, `${label}[${index}]`);
    exactKeys(platform, [
      "architecture",
      "codexExecutableDigest",
      "configurationDigest",
      "os",
      "toolInventoryDigest",
      "variant",
    ], `${label}[${index}]`);
    if (!ARCHITECTURES.includes(platform.architecture as DistributionArchitecture)) {
      fail(`${label}[${index}].architecture must be amd64 or arm64`);
    }
    exactString(platform.os, "linux", `${label}[${index}].os`);
    if (platform.variant !== null) fail(`${label}[${index}].variant must be null`);
    digest(platform.codexExecutableDigest, `${label}[${index}].codexExecutableDigest`);
    digest(platform.configurationDigest, `${label}[${index}].configurationDigest`);
    digest(platform.toolInventoryDigest, `${label}[${index}].toolInventoryDigest`);
    return Object.freeze({
      architecture: platform.architecture as DistributionArchitecture,
      codexExecutableDigest: platform.codexExecutableDigest,
      configurationDigest: platform.configurationDigest,
      os: "linux" as const,
      toolInventoryDigest: platform.toolInventoryDigest,
      variant: null,
    });
  });
  assertOrderedPlatforms(output, label);
  return Object.freeze(output);
}

function parseBuildPlatforms(value: unknown, label: string): readonly JsonObject[] {
  const output = platformArray(value, label).map((entry, index) => {
    const platform = object(entry, `${label}[${index}]`);
    exactKeys(
      platform,
      ["architecture", "configurationDigest", "manifestDigest", "os", "variant"],
      `${label}[${index}]`,
    );
    if (!ARCHITECTURES.includes(platform.architecture as DistributionArchitecture)) {
      fail(`${label}[${index}].architecture must be amd64 or arm64`);
    }
    exactString(platform.os, "linux", `${label}[${index}].os`);
    if (platform.variant !== null) fail(`${label}[${index}].variant must be null`);
    digest(platform.configurationDigest, `${label}[${index}].configurationDigest`);
    digest(platform.manifestDigest, `${label}[${index}].manifestDigest`);
    return Object.freeze(platform);
  });
  assertOrderedPlatforms(
    output as unknown as readonly { architecture: DistributionArchitecture }[],
    label,
  );
  return Object.freeze(output);
}

function parseBuildExecutionPlatforms(value: unknown, label: string): readonly JsonObject[] {
  const output = platformArray(value, label).map((entry, index) => {
    const platform = object(entry, `${label}[${index}]`);
    exactKeys(platform, [
      "architecture",
      "codexExecutableDigest",
      "configurationDigest",
      "manifestDigest",
      "os",
      "toolInventoryDigest",
      "variant",
    ], `${label}[${index}]`);
    if (!ARCHITECTURES.includes(platform.architecture as DistributionArchitecture)) {
      fail(`${label}[${index}].architecture must be amd64 or arm64`);
    }
    exactString(platform.os, "linux", `${label}[${index}].os`);
    if (platform.variant !== null) fail(`${label}[${index}].variant must be null`);
    digest(platform.codexExecutableDigest, `${label}[${index}].codexExecutableDigest`);
    digest(platform.configurationDigest, `${label}[${index}].configurationDigest`);
    digest(platform.manifestDigest, `${label}[${index}].manifestDigest`);
    digest(platform.toolInventoryDigest, `${label}[${index}].toolInventoryDigest`);
    return Object.freeze(platform);
  });
  assertOrderedPlatforms(
    output as unknown as readonly { architecture: DistributionArchitecture }[],
    label,
  );
  return Object.freeze(output);
}

function withoutPlatformManifestDigest(platform: JsonObject): JsonObject {
  const { manifestDigest: _privateManifestDigest, ...publicPlatform } = platform;
  return publicPlatform;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  const source = value as JsonObject;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalValue(source[key])]));
}

export function canonicalManifestBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonicalValue(value), null, 2)}\n`, "utf8");
}

export function distributionManifestDigest(value: DistributionManifest): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalManifestBytes(value)).digest("hex")}`;
}

export function parseDistributionManifestValue(value: unknown): DistributionManifest {
  const root = object(value, "manifest");
  exactKeys(root, ["coordinates", "distribution", "images", "schema"], "manifest");
  exactString(root.schema, DISTRIBUTION_MANIFEST_SCHEMA, "manifest.schema");

  const coordinates = object(root.coordinates, "manifest.coordinates");
  exactKeys(coordinates, [
    "interfaceProtocol",
    "providerAdapter",
    "qualificationRevision",
    "repositoryContract",
    "runtimeProtocol",
  ], "manifest.coordinates");
  exactString(coordinates.interfaceProtocol, "lifecycle.interface.foundation.v17", "interface protocol");
  exactString(coordinates.providerAdapter, "lifecycle.provider-adapter.v7", "provider adapter");
  exactString(coordinates.qualificationRevision, "lifecycle.foundation.1.0.0-rc.17", "qualification revision");
  exactString(coordinates.repositoryContract, "lifecycle.repository.v22", "repository contract");
  exactString(coordinates.runtimeProtocol, "lifecycle.runtime.foundation.v17", "runtime protocol");

  const distribution = object(root.distribution, "manifest.distribution");
  exactKeys(distribution, [
    "nodeMinimum",
    "npmPackage",
    "runtimeInvocationProtocol",
    "sourceRevision",
    "version",
  ], "manifest.distribution");
  exactString(distribution.nodeMinimum, "24.14.0", "Node minimum");
  exactString(distribution.npmPackage, "@neutral/lifecycle", "npm package");
  exactString(distribution.runtimeInvocationProtocol, RUNTIME_INVOCATION_PROTOCOL, "Runtime invocation protocol");
  exactString(distribution.version, "1.0.0", "distribution version");
  if (typeof distribution.sourceRevision !== "string" || !SOURCE_REVISION.test(distribution.sourceRevision)) {
    fail("source revision must be one full lowercase Git object identity");
  }

  const images = object(root.images, "manifest.images");
  exactKeys(images, ["execution", "runtime"], "manifest.images");
  const runtime = object(images.runtime, "manifest.images.runtime");
  exactKeys(runtime, ["indexDigest", "platforms", "repository"], "Runtime Image");
  exactString(runtime.repository, RUNTIME_IMAGE_REPOSITORY, "Runtime Image repository");
  digest(runtime.indexDigest, "Runtime Image index digest");
  const runtimePlatforms = parsePlatforms(runtime.platforms, "Runtime Image platforms");

  const execution = object(images.execution, "manifest.images.execution");
  exactKeys(execution, [
    "agentAdapterImplementationDigest",
    "codexVersion",
    "imageId",
    "indexDigest",
    "nonRootUser",
    "platforms",
    "repository",
    "runnerContractDigest",
    "runnerContractId",
    "runnerImplementationDigest",
  ], "Execution Image");
  exactString(execution.repository, EXECUTION_IMAGE_REPOSITORY, "Execution Image repository");
  exactString(execution.codexVersion, "0.153.4", "Execution Image Codex version");
  exactString(execution.nonRootUser, "65532:65532", "Execution Image user");
  exactString(execution.runnerContractId, "lifecycle.execution-cell-runner.v1", "runner contract");
  if (typeof execution.imageId !== "string" || !OPAQUE_ID.test(execution.imageId)) {
    fail("Execution Image identity is not one bounded opaque identity");
  }
  for (const [name, value] of [
    ["agent adapter implementation", execution.agentAdapterImplementationDigest],
    ["index", execution.indexDigest],
    ["runner contract", execution.runnerContractDigest],
    ["runner implementation", execution.runnerImplementationDigest],
  ] as const) digest(value, `Execution Image ${name} digest`);
  if (execution.agentAdapterImplementationDigest !== execution.runnerImplementationDigest) {
    fail("Execution Image Agent adapter must select the fixed runner implementation");
  }
  const executionPlatforms = parseExecutionPlatforms(execution.platforms, "Execution Image platforms");
  if (JSON.stringify(runtimePlatforms.map(({ architecture }) => architecture)) !==
      JSON.stringify(executionPlatforms.map(({ architecture }) => architecture))) {
    fail("Runtime and Execution Images must select the same platform set");
  }

  return Object.freeze({
    coordinates: Object.freeze({
      interfaceProtocol: "lifecycle.interface.foundation.v17" as const,
      providerAdapter: "lifecycle.provider-adapter.v7" as const,
      qualificationRevision: "lifecycle.foundation.1.0.0-rc.17" as const,
      repositoryContract: "lifecycle.repository.v22" as const,
      runtimeProtocol: "lifecycle.runtime.foundation.v17" as const,
    }),
    distribution: Object.freeze({
      nodeMinimum: "24.14.0" as const,
      npmPackage: "@neutral/lifecycle" as const,
      runtimeInvocationProtocol: RUNTIME_INVOCATION_PROTOCOL,
      sourceRevision: distribution.sourceRevision,
      version: "1.0.0" as const,
    }),
    images: Object.freeze({
      execution: Object.freeze({
        agentAdapterImplementationDigest:
          execution.agentAdapterImplementationDigest as `sha256:${string}`,
        codexVersion: "0.153.4" as const,
        imageId: execution.imageId,
        indexDigest: execution.indexDigest as `sha256:${string}`,
        nonRootUser: "65532:65532" as const,
        platforms: executionPlatforms,
        repository: EXECUTION_IMAGE_REPOSITORY,
        runnerContractDigest: execution.runnerContractDigest as `sha256:${string}`,
        runnerContractId: "lifecycle.execution-cell-runner.v1" as const,
        runnerImplementationDigest:
          execution.runnerImplementationDigest as `sha256:${string}`,
      }),
      runtime: Object.freeze({
        indexDigest: runtime.indexDigest as `sha256:${string}`,
        platforms: runtimePlatforms,
        repository: RUNTIME_IMAGE_REPOSITORY,
      }),
    }),
    schema: DISTRIBUTION_MANIFEST_SCHEMA,
  });
}

export function parseDistributionManifestBytes(bytes: Uint8Array): DistributionManifest {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail("bytes must contain strict UTF-8 JSON");
  }
  const manifest = parseDistributionManifestValue(value);
  if (!Buffer.from(bytes).equals(canonicalManifestBytes(manifest))) {
    fail("bytes must be canonical sorted JSON with one final line feed");
  }
  return manifest;
}

export function platformSelection(
  manifest: DistributionManifest,
  kind: "runtime" | "execution",
  architecture: DistributionArchitecture,
): DistributionPlatformSelection {
  const matches = manifest.images[kind].platforms.filter((entry) => entry.architecture === architecture);
  if (matches.length !== 1) fail(`${kind} image does not select linux/${architecture}`);
  return matches[0]!;
}

const TEMPLATE_VALUE = Object.freeze({
  coordinates: Object.freeze({
    interfaceProtocol: "lifecycle.interface.foundation.v17",
    providerAdapter: "lifecycle.provider-adapter.v7",
    qualificationRevision: "lifecycle.foundation.1.0.0-rc.17",
    repositoryContract: "lifecycle.repository.v22",
    runtimeProtocol: "lifecycle.runtime.foundation.v17",
  }),
  distribution: Object.freeze({
    nodeMinimum: "24.14.0",
    npmPackage: "@neutral/lifecycle",
    runtimeInvocationProtocol: RUNTIME_INVOCATION_PROTOCOL,
    version: "1.0.0",
  }),
  images: Object.freeze({
    execution: Object.freeze({ repository: EXECUTION_IMAGE_REPOSITORY }),
    runtime: Object.freeze({ repository: RUNTIME_IMAGE_REPOSITORY }),
  }),
  schema: DISTRIBUTION_TEMPLATE_SCHEMA,
});

export function assertDistributionTemplateBytes(bytes: Uint8Array): void {
  if (!Buffer.from(bytes).equals(canonicalManifestBytes(TEMPLATE_VALUE))) {
    fail("source template differs from the fixed Foundation distribution selection");
  }
}

export function createDistributionManifestFromSelection(value: unknown): DistributionManifest {
  const selection = object(value, "build selection");
  exactKeys(selection, ["images", "schema", "sourceRevision"], "build selection");
  exactString(selection.schema, DISTRIBUTION_SELECTION_SCHEMA, "build selection schema");
  if (typeof selection.sourceRevision !== "string" || !SOURCE_REVISION.test(selection.sourceRevision)) {
    fail("build source revision must be one full lowercase Git object identity");
  }
  const images = object(selection.images, "build selection images");
  exactKeys(images, ["execution", "runtime"], "build selection images");
  const runtime = object(images.runtime, "build Runtime Image selection");
  exactKeys(runtime, ["indexDigest", "platforms"], "build Runtime Image selection");
  const runtimePlatforms = parseBuildPlatforms(
    runtime.platforms,
    "build Runtime Image platforms",
  );
  const execution = object(images.execution, "build Execution Image selection");
  exactKeys(execution, [
    "agentAdapterImplementationDigest",
    "codexVersion",
    "imageId",
    "indexDigest",
    "nonRootUser",
    "platforms",
    "runnerContractDigest",
    "runnerContractId",
    "runnerImplementationDigest",
  ], "build Execution Image selection");
  const executionPlatforms = parseBuildExecutionPlatforms(
    execution.platforms,
    "build Execution Image platforms",
  );
  if (JSON.stringify(runtimePlatforms.map(({ architecture }) => architecture)) !==
      JSON.stringify(executionPlatforms.map(({ architecture }) => architecture))) {
    fail("build Runtime and Execution Images must select the same platform set");
  }
  return parseDistributionManifestValue({
    coordinates: TEMPLATE_VALUE.coordinates,
    distribution: {
      ...TEMPLATE_VALUE.distribution,
      sourceRevision: selection.sourceRevision,
    },
    images: {
      execution: {
        ...execution,
        platforms: executionPlatforms.map(withoutPlatformManifestDigest),
        repository: EXECUTION_IMAGE_REPOSITORY,
      },
      runtime: {
        ...runtime,
        platforms: runtimePlatforms.map(withoutPlatformManifestDigest),
        repository: RUNTIME_IMAGE_REPOSITORY,
      },
    },
    schema: DISTRIBUTION_MANIFEST_SCHEMA,
  });
}

export function parseDistributionBuildSelectionBytes(bytes: Uint8Array): DistributionManifest {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail("build selection must contain strict UTF-8 JSON");
  }
  if (!Buffer.from(bytes).equals(canonicalManifestBytes(value))) {
    fail("build selection must be canonical sorted JSON with one final line feed");
  }
  return createDistributionManifestFromSelection(value);
}
