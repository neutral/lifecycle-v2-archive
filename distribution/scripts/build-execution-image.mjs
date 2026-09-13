#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { parseNamedArguments, run, withExactSourceSnapshot } from "./lib.mjs";

const names = [
  "--architecture",
  "--bubblewrap-version",
  "--ca-certificates-version",
  "--codex-executable-digest",
  "--git-version",
  "--image-id",
  "--node-image",
  "--runner-contract-digest",
  "--runner-implementation-digest",
  "--source-revision",
  "--tag",
  "--tool-inventory-digest",
];
const values = parseNamedArguments(process.argv.slice(2), names);
const architecture = values.get("--architecture");
if (architecture !== "amd64" && architecture !== "arm64") {
  throw new TypeError("Execution Image architecture must be amd64 or arm64");
}
if (!/@sha256:[a-f0-9]{64}$/u.test(values.get("--node-image"))) {
  throw new TypeError("Execution Image Node base must select one immutable image digest");
}
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(values.get("--image-id"))) {
  throw new TypeError("Execution Image identity must be one bounded opaque identity");
}
if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(values.get("--source-revision"))) {
  throw new TypeError("Execution Image source revision must be one full lowercase Git object identity");
}
for (const name of ["--bubblewrap-version", "--ca-certificates-version", "--git-version"]) {
  if (!/^[0-9][A-Za-z0-9.+:~-]{0,159}$/u.test(values.get(name))) {
    throw new TypeError(`${name} must be one exact bounded Debian package version`);
  }
}
for (const name of [
  "--codex-executable-digest",
  "--runner-contract-digest",
  "--runner-implementation-digest",
  "--tool-inventory-digest",
]) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(values.get(name))) {
    throw new TypeError(`${name} must be one lowercase SHA-256 digest`);
  }
}
await withExactSourceSnapshot(values.get("--source-revision"), async (sourceRoot) => {
  const runtimeRoot = `${sourceRoot}/runtime`;
  const executionImageRoot = `${runtimeRoot}/execution-image`;
  const contractBytes = readFileSync(`${executionImageRoot}/runner-contract.private.json`);
  const inventoryBytes = readFileSync(
    `${executionImageRoot}/tool-inventory.linux-${architecture}.json`,
  );
  const contract = JSON.parse(contractBytes.toString("utf8"));
  const inventory = JSON.parse(inventoryBytes.toString("utf8"));
  const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const inventoryEntry = (path) => inventory.entries?.find((entry) => entry.path === path);
  if (values.get("--runner-contract-digest") !== sha256(contractBytes) ||
      values.get("--runner-implementation-digest") !== contract.runnerExecutable?.digest ||
      values.get("--runner-implementation-digest") !==
        inventoryEntry("/opt/lifecycle/bin/execution-cell-runner")?.digest ||
      values.get("--codex-executable-digest") !== inventoryEntry("/opt/lifecycle/bin/codex")?.digest ||
      values.get("--tool-inventory-digest") !== sha256(inventoryBytes) ||
      inventory.platform?.architecture !== architecture || inventory.platform?.os !== "linux") {
    throw new TypeError("Execution Image selections differ from the exact tracked contract or platform inventory");
  }
  run("docker", [
    "build",
    "--pull=false",
    "--provenance=false",
    "--sbom=false",
    "--platform", `linux/${architecture}`,
    "--file", "runtime/execution-image/Dockerfile.agent-cell",
    "--tag", values.get("--tag"),
    "--build-arg", `LIFECYCLE_NODE_IMAGE=${values.get("--node-image")}`,
    "--build-arg", `LIFECYCLE_SOURCE_REVISION=${values.get("--source-revision")}`,
    "--build-arg", `LIFECYCLE_IMAGE_ID=${values.get("--image-id")}`,
    "--build-arg", `LIFECYCLE_RUNNER_CONTRACT_DIGEST=${values.get("--runner-contract-digest")}`,
    "--build-arg", `LIFECYCLE_RUNNER_IMPLEMENTATION_DIGEST=${values.get("--runner-implementation-digest")}`,
    "--build-arg", `LIFECYCLE_TOOL_INVENTORY_DIGEST=${values.get("--tool-inventory-digest")}`,
    "--build-arg", `LIFECYCLE_CODEX_EXECUTABLE_IDENTITY=${values.get("--codex-executable-digest")}`,
    "--build-arg", `LIFECYCLE_BUBBLEWRAP_VERSION=${values.get("--bubblewrap-version")}`,
    "--build-arg", `LIFECYCLE_CA_CERTIFICATES_VERSION=${values.get("--ca-certificates-version")}`,
    "--build-arg", `LIFECYCLE_GIT_VERSION=${values.get("--git-version")}`,
    sourceRoot,
  ], { cwd: sourceRoot, stdio: "inherit" });
});
