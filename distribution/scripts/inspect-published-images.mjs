#!/usr/bin/env node

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  assertCleanSourceRevision,
  buildDistributionPackage,
  exactExternalOutputPath,
  fail,
  parseNamedArguments,
  run,
} from "./lib.mjs";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const RUNTIME_REPOSITORY = "ghcr.io/neutral/lifecycle-runtime";
const EXECUTION_REPOSITORY = "ghcr.io/neutral/lifecycle-execution";
const values = parseNamedArguments(process.argv.slice(2), [
  "--execution-reference",
  "--output",
  "--runtime-reference",
  "--source-revision",
]);
const output = exactExternalOutputPath(values.get("--output"), "build-selection output");
const sourceRevision = values.get("--source-revision");
if (!SOURCE_REVISION.test(sourceRevision)) fail("source revision is not one full lowercase Git identity");
assertCleanSourceRevision(sourceRevision);

function selectedReference(value, repository, label) {
  const match = new RegExp(`^${repository.replace(/[./-]/gu, "\\$&")}@(sha256:[a-f0-9]{64})$`, "u").exec(value);
  if (match === null) fail(`${label} must be ${repository}@<exact-index-digest>`);
  return Object.freeze({ digest: match[1], reference: value, repository });
}

const runtimeReference = selectedReference(
  values.get("--runtime-reference"),
  RUNTIME_REPOSITORY,
  "Runtime Image reference",
);
const executionReference = selectedReference(
  values.get("--execution-reference"),
  EXECUTION_REPOSITORY,
  "Execution Image reference",
);
const docker = process.env.LIFECYCLE_DISTRIBUTION_DOCKER_PATH ?? "docker";

function inspectRaw(reference) {
  const result = run(docker, ["buildx", "imagetools", "inspect", "--raw", reference]);
  const bytes = Buffer.from(result.stdout, "utf8");
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`OCI inspection for ${reference} is not JSON`); }
  return Object.freeze({ bytes, value });
}

function inspectImageConfiguration(reference) {
  const result = run(docker, [
    "buildx", "imagetools", "inspect", "--format", "{{json .Image}}", reference,
  ]);
  let value;
  try { value = JSON.parse(result.stdout); } catch { fail(`OCI configuration for ${reference} is not JSON`); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`OCI configuration for ${reference} is not one object`);
  }
  return value;
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function verifyRawDigest(bytes, expected, label) {
  if (digestBytes(bytes) === expected) return;
  if (bytes.at(-1) === 0x0a && digestBytes(bytes.subarray(0, -1)) === expected) return;
  fail(`${label} bytes differ from the selected digest`);
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} is not one object`);
  return value;
}

function exactDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} is not one SHA-256 digest`);
  return value;
}

function labels(image, label) {
  const config = object(image.config, `${label} configuration`);
  return Object.freeze({
    config,
    labels: object(config.Labels, `${label} labels`),
  });
}

function indexPlatforms(selection, kind) {
  const inspected = inspectRaw(selection.reference);
  verifyRawDigest(inspected.bytes, selection.digest, `${kind} index`);
  const index = object(inspected.value, `${kind} index`);
  if (index.schemaVersion !== 2 || ![
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
  ].includes(index.mediaType) || !Array.isArray(index.manifests) || index.manifests.length !== 2) {
    fail(`${kind} index must contain exactly two OCI platform manifests`);
  }
  const descriptors = index.manifests.map((entry, position) => {
    const descriptor = object(entry, `${kind} index descriptor ${position}`);
    const platform = object(descriptor.platform, `${kind} descriptor platform ${position}`);
    if (platform.os !== "linux" || platform.variant !== undefined ||
        (platform.architecture !== "amd64" && platform.architecture !== "arm64")) {
      fail(`${kind} descriptor ${position} is not linux/amd64 or linux/arm64 without a variant`);
    }
    return Object.freeze({
      architecture: platform.architecture,
      digest: exactDigest(descriptor.digest, `${kind} platform manifest digest`),
    });
  }).sort((left, right) => left.architecture.localeCompare(right.architecture));
  if (descriptors[0]?.architecture !== "amd64" || descriptors[1]?.architecture !== "arm64") {
    fail(`${kind} index must contain exactly one amd64 and one arm64 manifest`);
  }
  return descriptors.map((descriptor) => {
    const reference = `${selection.repository}@${descriptor.digest}`;
    const manifestInspection = inspectRaw(reference);
    verifyRawDigest(manifestInspection.bytes, descriptor.digest, `${kind} platform manifest`);
    const manifest = object(manifestInspection.value, `${kind} platform manifest`);
    if (manifest.schemaVersion !== 2 || ![
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
    ].includes(manifest.mediaType)) {
      fail(`${kind} platform descriptor is not one OCI image manifest`);
    }
    const configuration = object(manifest.config, `${kind} platform configuration descriptor`);
    const image = inspectImageConfiguration(reference);
    if (image.os !== "linux" || image.architecture !== descriptor.architecture) {
      fail(`${kind} configuration platform differs from its index descriptor`);
    }
    return Object.freeze({
      architecture: descriptor.architecture,
      configurationDigest: exactDigest(configuration.digest, `${kind} configuration digest`),
      image,
      manifestDigest: descriptor.digest,
      os: "linux",
      variant: null,
    });
  });
}

const runtimePlatforms = indexPlatforms(runtimeReference, "Runtime Image");
for (const platform of runtimePlatforms) {
  const selected = labels(platform.image, "Runtime Image").labels;
  if (selected["org.opencontainers.image.revision"] !== sourceRevision ||
      selected["org.opencontainers.image.version"] !== "1.0.0" ||
      selected["io.lifecycle.runtime-image.qualification-revision"] !==
        "lifecycle.foundation.1.0.0-rc.10" ||
      selected["io.lifecycle.runtime-image.runtime-invocation-protocol"] !==
        "lifecycle.runtime-invocation.private.v1") {
    fail("Runtime Image labels do not select this exact source and Foundation contract");
  }
}

const executionPlatforms = indexPlatforms(executionReference, "Execution Image");
let commonExecution = null;
const selectedExecutionPlatforms = executionPlatforms.map((platform) => {
  const selected = labels(platform.image, "Execution Image");
  if (selected.config.User !== "65532:65532" ||
      selected.labels["org.opencontainers.image.revision"] !== sourceRevision ||
      selected.labels["org.opencontainers.image.version"] !== "1.0.0" ||
      selected.labels["io.lifecycle.execution-image.v1.qualification-revision"] !==
        "lifecycle.foundation.1.0.0-rc.10") {
    fail("Execution Image configuration does not select this exact source and Foundation contract");
  }
  const common = Object.freeze({
    agentAdapterImplementationDigest: exactDigest(
      selected.labels["io.lifecycle.execution-image.v1.adapter-implementation-digest"],
      "Agent adapter implementation digest",
    ),
    codexVersion: selected.labels["io.lifecycle.execution-image.v1.codex-version"],
    imageId: selected.labels["io.lifecycle.execution-image.v1.image-id"],
    nonRootUser: selected.config.User,
    runnerContractDigest: exactDigest(
      selected.labels["io.lifecycle.execution-image.v1.runner-contract-digest"],
      "runner contract digest",
    ),
    runnerContractId: selected.labels["io.lifecycle.execution-image.v1.runner-contract-id"],
    runnerImplementationDigest: exactDigest(
      selected.labels["io.lifecycle.execution-image.v1.runner-implementation-digest"],
      "runner implementation digest",
    ),
  });
  if (common.codexVersion !== "0.151.0" ||
      common.runnerContractId !== "lifecycle.execution-cell-runner.v1" ||
      typeof common.imageId !== "string" ||
      common.agentAdapterImplementationDigest !== common.runnerImplementationDigest) {
    fail("Execution Image common labels are invalid");
  }
  if (commonExecution !== null && JSON.stringify(common) !== JSON.stringify(commonExecution)) {
    fail("Execution Image platform manifests do not share one common runner selection");
  }
  commonExecution = common;
  return Object.freeze({
    architecture: platform.architecture,
    codexExecutableDigest: exactDigest(
      selected.labels["io.lifecycle.execution-image.v1.codex-executable-identity"],
      "Codex executable digest",
    ),
    configurationDigest: platform.configurationDigest,
    manifestDigest: platform.manifestDigest,
    os: "linux",
    toolInventoryDigest: exactDigest(
      selected.labels["io.lifecycle.execution-image.v1.tool-inventory-digest"],
      "tool inventory digest",
    ),
    variant: null,
  });
});
if (commonExecution === null) fail("Execution Image has no selected platforms");

function canonical(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

const selection = {
  images: {
    execution: {
      ...commonExecution,
      indexDigest: executionReference.digest,
      platforms: selectedExecutionPlatforms,
    },
    runtime: {
      indexDigest: runtimeReference.digest,
      platforms: runtimePlatforms.map(({ image: _image, ...platform }) => platform),
    },
  },
  schema: "lifecycle.distribution-build-selection.private.v1",
  sourceRevision,
};
buildDistributionPackage();
const { createDistributionManifestFromSelection } = await import("../package/dist/src/manifest.js");
createDistributionManifestFromSelection(selection);
await writeFile(output, `${JSON.stringify(canonical(selection), null, 2)}\n`, { flag: "wx", mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output })}\n`);
