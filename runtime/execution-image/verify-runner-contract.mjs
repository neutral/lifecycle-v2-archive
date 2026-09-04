#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function fail(message) {
  throw new Error(`Execution Cell runner contract verification failed: ${message}`);
}

function ordered(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(ordered);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} does not have its exact closed shape`);
  }
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} is not one exact digest`);
  return value;
}

export async function verifyRunnerContract({
  manifestPath,
  runnerPath,
  expectedContractDigest,
  expectedRunnerDigest,
}) {
  const [manifestBytes, runnerBytes] = await Promise.all([
    readFile(resolve(manifestPath)),
    readFile(resolve(runnerPath)),
  ]);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("manifest is not JSON");
  }
  const canonicalBytes = Buffer.from(`${JSON.stringify(ordered(manifest), null, 2)}\n`, "utf8");
  if (!manifestBytes.equals(canonicalBytes)) fail("manifest bytes are not canonical sorted JSON");
  exactKeys(manifest, [
    "authorityExclusions",
    "contractId",
    "fixedPaths",
    "launchContracts",
    "limits",
    "materializationRules",
    "outputLayouts",
    "protocols",
    "runnerExecutable",
    "schema",
    "securityRules",
    "supportFileInventory",
    "terminalRules",
  ], "manifest");
  if (manifest.schema !== "lifecycle.execution-cell-runner-contract.private.v1" ||
      manifest.contractId !== "lifecycle.execution-cell-runner.v1") {
    fail("manifest does not identify the fixed v1 contract");
  }
  exactKeys(manifest.runnerExecutable, ["digest", "imagePath", "repositorySourcePath"],
    "runnerExecutable");
  if (manifest.runnerExecutable.imagePath !== "/opt/lifecycle/bin/execution-cell-runner" ||
      manifest.runnerExecutable.repositorySourcePath !==
        "src/util/execution-cell-runner-v1.ts") {
    fail("manifest runner paths differ from the fixed image build");
  }
  const manifestRunnerDigest = exactDigest(
    manifest.runnerExecutable.digest,
    "manifest runner executable digest",
  );
  const observedRunnerDigest = digest(runnerBytes);
  if (observedRunnerDigest !== manifestRunnerDigest) {
    fail("runner executable bytes differ from the manifest");
  }
  if (expectedRunnerDigest !== undefined &&
      exactDigest(expectedRunnerDigest, "selected runner digest") !== observedRunnerDigest) {
    fail("selected runner digest differs from the executable bytes");
  }
  const observedContractDigest = digest(manifestBytes);
  if (expectedContractDigest !== undefined &&
      exactDigest(expectedContractDigest, "selected contract digest") !== observedContractDigest) {
    fail("selected contract digest differs from the manifest bytes");
  }
  return Object.freeze({
    contractDigest: observedContractDigest,
    runnerDigest: observedRunnerDigest,
  });
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 2 && arguments_.length !== 4) {
    fail("usage: verify-runner-contract <manifest> <runner> [contract-digest runner-digest]");
  }
  const result = await verifyRunnerContract({
    manifestPath: arguments_[0],
    runnerPath: arguments_[1],
    ...(arguments_.length === 4
      ? { expectedContractDigest: arguments_[2], expectedRunnerDigest: arguments_[3] }
      : {}),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
