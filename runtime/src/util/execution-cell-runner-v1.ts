#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { connect, createServer, isIP, type Socket } from "node:net";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  readFile,
  rename,
  rmdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  FoundationExecutionSpecificationV1,
} from "../foundation/execution/contracts.js";

type Json = null | boolean | number | string | readonly Json[] |
  { readonly [key: string]: Json };
type Sha256 = `sha256:${string}`;

const SPECIFICATION_SCHEMA = "lifecycle.execution-specification.v1";
const OUTPUT_MANIFEST_SCHEMA = "lifecycle.execution-output-manifest.v1";
const RUNNER_CONTRACT = "lifecycle.execution-cell-runner.v1";
const INPUT_SET_SCHEMA = "lifecycle.execution-input-set.v1";
const INPUT_SET_PATH = ".lifecycle/input-set.json";
const CHECK_BINDING_PATH = "check/binding.json";
const CARRIER_MANIFEST_PATH = "candidate/carrier-manifest.json";
const CARRIER_ARTIFACT_PATH = "candidate/carrier.pack";
const PRODUCT_BASE_SUBJECT_PATH = "product-base/subject.json";
const PRODUCT_BASE_MANIFEST_PATH = "product-base/object-closure.json";
const PRODUCT_BASE_ARTIFACT_PATH = "product-base/object-closure.pack";
const OUTPUT_MANIFEST_PATH = ".lifecycle/output-manifest.json";
const PROOF_PATH = "check-proof/result.json";
const RAW_STREAMS_PATH = "raw-check-output/streams.json";
const ROLE_BRIEF_PATH = "role-brief.md";
const SEMANTIC_TEMPLATE_PATH = "semantic/template.md";
// Fixed transport paths belong to the shared runner contract. Keeping them
// here prevents a Check-only Execution Image from loading Agent owner code.
const AGENT_SEMANTIC_OUTPUT_PATH = "agent-work-product/semantic.md";
const AGENT_PROVIDER_RESULT_PATH = "provider-result/result.json";
const AGENT_PROVIDER_TERMINAL_OBSERVATION_PATH = "provider-terminal/observation.json";
const RUNNER_EXECUTABLE = "/opt/lifecycle/bin/execution-cell-runner";
const CODEX_EXECUTABLE = "/opt/lifecycle/bin/codex";
const PROVIDER_SUPPORT_ROOT = "/tmp/.lifecycle-provider-support";
const PROVIDER_SUPPORT_PATH = `${PROVIDER_SUPPORT_ROOT}/support.json`;
const PROVIDER_AUTH_PATH = `${PROVIDER_SUPPORT_ROOT}/auth.json`;
const PROVIDER_CODEX_HOME = "/tmp/lifecycle-codex-home";
const PROVIDER_VISIBLE_INPUT_ROOT = "/tmp/lifecycle-provider-input";
const MAXIMUM_PROVIDER_SUPPORT_BYTES = 64 * 1024;
const MAXIMUM_PROVIDER_AUTH_BYTES = 4 * 1024 * 1024;
const MAXIMUM_PROVIDER_EVENT_BYTES = 8 * 1024 * 1024;
const MAXIMUM_PROVIDER_EXECUTABLE_BYTES = 512 * 1024 * 1024;
// A denied write to a provider-visible read-only mount is reported as EROFS
// by the Linux sandbox rather than as a discretionary-permission failure.
export const foundationAgentReadOnlyWriteDenialCodesV1 = Object.freeze([
  "EACCES",
  "EPERM",
  "EROFS",
] as const);
const PROVIDER_SUPPORT_SCHEMA = "lifecycle.agent-provider-support.private.v1";
const PROVIDER_SUPPORT_WAIT_MILLISECONDS = 30_000;
const PROVIDER_SUPPORT_FRAME_MAGIC = Buffer.from("LCPSV1!\0", "binary");
const PROVIDER_CONTROL_HOST = "provider-control";
const PROVIDER_CONTROL_PORT = 18_080;
const PROVIDER_CONTROL_READY_PATH = "/tmp/lifecycle-provider-control-ready";
const PROVIDER_CONTROL_ALLOWED_DESTINATIONS = Object.freeze([
  "api.openai.com",
  "auth.openai.com",
  "chatgpt.com",
] as const);
const MAXIMUM_PROVIDER_CONTROL_HEADER_BYTES = 8 * 1024;
const MAXIMUM_PROVIDER_CONTROL_CONNECTIONS = 16;
const MAXIMUM_CONTROL_BYTES = 4 * 1024 * 1024;
// Two base64 streams plus fixed JSON must remain below the 16 MiB raw-output root.
const MAXIMUM_STREAM_BYTES = 4 * 1024 * 1024;
const MAXIMUM_INPUT_ENTRIES = 16_384;
const MAXIMUM_CANDIDATE_ENTRIES = 1_000_000;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

class ExecutionCellRunnerFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionCellRunnerFailure";
  }
}

function fail(message: string): never {
  throw new ExecutionCellRunnerFailure(message);
}

function canonical(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical((value as Record<string, Json>)[key]!)}`).join(",")}}`;
}

function sha256(bytes: Uint8Array | string): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function selfDigest(value: Record<string, Json>): Sha256 {
  const { digest: _digest, ...subject } = value;
  return sha256(canonical(subject));
}

function record(value: unknown, label: string): Record<string, Json> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} is not an object`);
  return value as Record<string, Json>;
}

function exactKeys(value: Record<string, Json>, keys: readonly string[], label: string): void {
  const observed = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonical(observed) !== canonical(expected)) fail(`${label} does not have its exact closed shape`);
}

function text(value: Json | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) fail(`${label} is invalid`);
  return value;
}

function integer(value: Json | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(`${label} is invalid`);
  return value;
}

function safeRelativePath(value: string, label: string): string {
  if (
    value.length === 0 || value.startsWith("/") || value.includes("\\") || value.includes("\0") ||
    normalize(value) !== value || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) fail(`${label} is not one normalized relative path`);
  return value;
}

function within(parent: string, child: string): boolean {
  const displacement = relative(parent, child);
  return displacement === "" || (
    displacement !== ".." && !displacement.startsWith(`..${sep}`) && !isAbsolute(displacement)
  );
}

async function boundedJson(
  path: string,
  label: string,
  maximumBytes = MAXIMUM_CONTROL_BYTES,
): Promise<Record<string, Json>> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 2 || before.size > maximumBytes) {
    fail(`${label} is not one bounded regular file`);
  }
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (bytes.byteLength !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
      after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
    fail(`${label} changed while it was read`);
  }
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { fail(`${label} is not JSON`); }
  return record(value, label);
}

async function digestFile(path: string, maximumBytes: number, label: string): Promise<Readonly<{
  byteLength: number;
  digest: Sha256;
}>> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) {
    fail(`${label} is not one bounded regular file`);
  }
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    if (!(chunk instanceof Uint8Array)) fail(`${label} yielded invalid bytes`);
    byteLength += chunk.byteLength;
    if (!Number.isSafeInteger(byteLength) || byteLength > before.size || byteLength > maximumBytes) {
      fail(`${label} changed or exceeded its byte bound`);
    }
    hash.update(chunk);
  }
  const after = await lstat(path);
  if (!after.isFile() || after.isSymbolicLink() || byteLength !== before.size ||
      after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
    fail(`${label} changed while it was observed`);
  }
  return Object.freeze({
    byteLength,
    digest: `sha256:${hash.digest("hex")}`,
  });
}

async function exactFileTree(input: Readonly<{
  root: string;
  expectedFiles: ReadonlySet<string>;
  maximumEntries: number;
  label: string;
}>): Promise<void> {
  const expectedDirectories = new Set<string>();
  for (const path of input.expectedFiles) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      expectedDirectories.add(parts.slice(0, index).join("/"));
    }
  }
  const observedFiles = new Set<string>();
  const pending = [input.root];
  let observedEntries = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const selected: Array<Readonly<{ name: string; directory: boolean; file: boolean }>> = [];
    const opened = await opendir(directory);
    for await (const entry of opened) {
      observedEntries += 1;
      if (observedEntries > input.maximumEntries) fail(`${input.label} exceeds its entry bound`);
      selected.push(Object.freeze({
        name: entry.name,
        directory: entry.isDirectory(),
        file: entry.isFile(),
      }));
    }
    selected.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of selected) {
      const absolute = join(directory, entry.name);
      const path = relative(input.root, absolute).split(sep).join("/");
      if (entry.directory) {
        if (!expectedDirectories.has(path)) fail(`${input.label} contains an extra directory`);
        pending.push(absolute);
      } else if (entry.file) {
        if (!input.expectedFiles.has(path) || observedFiles.has(path)) {
          fail(`${input.label} contains an extra or duplicate file`);
        }
        observedFiles.add(path);
      } else {
        fail(`${input.label} contains a link or special entry`);
      }
    }
  }
  if (observedFiles.size !== input.expectedFiles.size) fail(`${input.label} is missing an exact file`);
}

function subjectComparison(left: Record<string, Json>, right: Record<string, Json>): number {
  const values = ["kind", "id", "revision", "digest"] as const;
  for (const name of values) {
    const leftValue = left[name];
    const rightValue = right[name];
    if (leftValue === rightValue) continue;
    if (leftValue === null) return -1;
    if (rightValue === null) return 1;
    return String(leftValue) < String(rightValue) ? -1 : 1;
  }
  return 0;
}

function exactDigest(value: Json | undefined, label: string): Sha256 {
  const selected = text(value, label);
  if (!SHA256.test(selected)) fail(`${label} is not one lowercase SHA-256 digest`);
  return selected as Sha256;
}

function validateSpecification(specification: Record<string, Json>): void {
  exactKeys(specification, [
    "backendProfile",
    "capabilities",
    "credentialPolicy",
    "digest",
    "environment",
    "image",
    "inputSet",
    "limits",
    "networkPolicy",
    "operation",
    "outputContract",
    "owner",
    "runner",
    "schema",
    "terminalPolicy",
  ], "Execution Specification");
  if (specification.schema !== SPECIFICATION_SCHEMA || specification.digest !== selfDigest(specification)) {
    fail("Execution Specification failed its exact identity");
  }

  const owner = record(specification.owner, "Execution Specification owner");
  const agent = owner.kind === "agent-attempt";
  if (agent) {
    exactKeys(owner, ["activityId", "attempt", "kind"], "Execution Specification owner");
    if (text(owner.activityId, "Execution owner Activity").length > 512) {
      fail("Execution Specification Agent owner exceeds its bound");
    }
    const attempt = record(owner.attempt, "Execution Specification Agent Attempt");
    exactKeys(attempt, ["digest", "id", "kind", "revision"], "Execution Specification Agent Attempt");
    if (attempt.kind !== "agent-attempt" ||
        text(attempt.id, "Execution Specification Agent Attempt identity").length > 512 ||
        integer(attempt.revision, "Execution Specification Agent Attempt revision") < 1) {
      fail("Execution Specification Agent owner is invalid");
    }
    exactDigest(attempt.digest, "Execution Specification Agent Attempt digest");
  } else {
    exactKeys(owner, ["activityId", "kind", "ownerSubjectDigest", "phase", "selectionId"], "Execution Specification owner");
    if (owner.kind !== "check" || text(owner.activityId, "Execution owner Activity").length > 512 ||
        text(owner.selectionId, "Execution owner selection").length > 512 ||
        !["baseline", "final"].includes(String(owner.phase))) {
      fail("Execution Specification owner is not one bounded Check or Agent owner");
    }
    exactDigest(owner.ownerSubjectDigest, "Execution owner subject digest");
  }

  const backend = record(specification.backendProfile, "Execution Backend Profile reference");
  exactKeys(backend, ["implementationDigest", "profileDigest", "profileId"], "Execution Backend Profile reference");
  if (backend.profileId !== "lifecycle.execution-backend-profile.docker-local.v1") {
    fail("Execution Specification does not select the production Docker profile");
  }
  exactDigest(backend.profileDigest, "Execution Backend Profile digest");
  exactDigest(backend.implementationDigest, "Execution Backend implementation digest");

  const image = record(specification.image, "Execution Image reference");
  exactKeys(image, ["imageDigest", "imageId"], "Execution Image reference");
  if (text(image.imageId, "Execution Image identity").length > 512) {
    fail("Execution Image identity exceeds its bound");
  }
  exactDigest(image.imageDigest, "Execution Image digest");

  const inputSet = record(specification.inputSet, "Execution Input Set reference");
  exactKeys(inputSet, ["digest", "profileId"], "Execution Input Set reference");
  if (inputSet.profileId !== INPUT_SET_SCHEMA) fail("Execution Input Set profile is invalid");
  exactDigest(inputSet.digest, "Execution Input Set digest");

  const operation = record(specification.operation, "Execution Specification operation");
  if (agent) {
    exactKeys(operation, [
      "adapterImplementationDigest",
      "kind",
      "providerDescriptorDigest",
      "role",
    ], "Execution Specification operation");
    if (operation.kind !== "agent-attempt" ||
        !["reconnaissance", "builder", "reviewer"].includes(String(operation.role))) {
      fail("Execution Specification operation differs from its Agent owner");
    }
    exactDigest(operation.providerDescriptorDigest, "Provider Descriptor digest");
    exactDigest(operation.adapterImplementationDigest, "Provider Adapter implementation digest");
  } else {
    exactKeys(operation, [
      "bindingDigest",
      "definitionDigest",
      "kind",
      "parserImplementationDigest",
      "phase",
      "runnerImplementationDigest",
      "selectionId",
    ], "Execution Specification operation");
    if (operation.kind !== "check" || operation.selectionId !== owner.selectionId ||
        operation.phase !== owner.phase || !["baseline", "final"].includes(String(operation.phase))) {
      fail("Execution Specification operation differs from its Check owner");
    }
    exactDigest(operation.bindingDigest, "Check Binding digest");
    exactDigest(operation.definitionDigest, "Check Definition digest");
    exactDigest(operation.parserImplementationDigest, "Check parser implementation digest");
    exactDigest(operation.runnerImplementationDigest, "Check runner implementation digest");
  }

  const runner = record(specification.runner, "Execution Specification runner");
  exactKeys(runner, ["argumentsDigest", "contractDigest", "contractId", "operationId"], "Execution Specification runner");
  if (runner.contractId !== RUNNER_CONTRACT ||
      runner.operationId !== (agent ? `agent-attempt.${String(operation.role)}` : "check.execute")) {
    fail("Execution Specification does not select its fixed owner runner");
  }
  exactDigest(runner.argumentsDigest, "Execution runner arguments digest");
  exactDigest(runner.contractDigest, "Execution runner contract digest");

  if (!Array.isArray(specification.environment) || specification.environment.length > 256) {
    fail("Execution Specification environment exceeds its bound");
  }
  let previousEnvironmentName: string | null = null;
  for (const [index, value] of specification.environment.entries()) {
    const entry = record(value, `Execution environment entry ${index}`);
    exactKeys(entry, ["bindingDigest", "name", "source"], `Execution environment entry ${index}`);
    const name = text(entry.name, `Execution environment entry ${index} name`);
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/u.test(name) ||
        previousEnvironmentName !== null && previousEnvironmentName >= name ||
        !(agent
          ? ["fixed-runtime", "input-set", "credential-injection"].includes(String(entry.source))
          : entry.source === "input-set")) {
      fail("Execution Specification environment is not exact and strictly ordered");
    }
    exactDigest(entry.bindingDigest, `Execution environment entry ${index} digest`);
    previousEnvironmentName = name;
  }

  const capabilities = record(specification.capabilities, "Execution capabilities");
  exactKeys(capabilities, [
    "candidateWrites",
    "capabilityProfileDigest",
    "dockerDaemonAccess",
    "externalEffects",
    "subprocesses",
    "temporaryWrites",
  ], "Execution capabilities");
  if (capabilities.dockerDaemonAccess !== false ||
      (capabilities.subprocesses !== "none" &&
        capabilities.subprocesses !== "repository-toolchain") ||
      typeof capabilities.temporaryWrites !== "boolean" ||
      typeof capabilities.externalEffects !== "boolean" ||
      capabilities.candidateWrites !== (agent && operation.role === "builder")) {
    fail("Execution Specification grants capability outside its exact owner contract");
  }
  if (!agent && (capabilities.temporaryWrites !== true ||
      capabilities.subprocesses !== "repository-toolchain" ||
      capabilities.externalEffects !== false)) {
    fail("Execution Specification grants unsupported Check capability");
  }
  exactDigest(capabilities.capabilityProfileDigest, "Execution capability profile digest");

  const network = record(specification.networkPolicy, "Execution network policy");
  exactKeys(network, [
    "agentPolicyDigest",
    "agentProductNetwork",
    "providerControlPlane",
    "providerPolicyDigest",
    "separationRequired",
  ], "Execution network policy");
  if (!["none", "loopback", "bounded-egress"].includes(String(network.agentProductNetwork)) ||
      network.separationRequired !== true) {
    fail("Execution Specification network policy is invalid");
  }
  exactDigest(network.agentPolicyDigest, "Execution network policy digest");
  if (agent) {
    if (!(["none", "fixed-service-channel"] as unknown[]).includes(network.providerControlPlane) ||
        (network.providerControlPlane === "none") !== (network.providerPolicyDigest === null)) {
      fail("Execution Specification Agent provider-control policy is invalid");
    }
    if (network.providerPolicyDigest !== null) {
      exactDigest(network.providerPolicyDigest, "Execution provider-control policy digest");
    }
  } else if (network.providerControlPlane !== "none" || network.providerPolicyDigest !== null) {
    fail("Execution Specification Check cannot receive a provider-control channel");
  }

  const credentials = record(specification.credentialPolicy, "Execution credential policy");
  exactKeys(credentials, ["agentAccess", "bindings", "mode", "outputDisclosure"], "Execution credential policy");
  if (!Array.isArray(credentials.bindings) || credentials.agentAccess !== false ||
      credentials.outputDisclosure !== false ||
      !["none", "fixed-runner", "isolated-broker"].includes(String(credentials.mode))) {
    fail("Execution Specification credential policy is invalid");
  }
  if (!agent && (credentials.mode !== "none" || credentials.bindings.length !== 0)) {
    fail("Execution Specification grants unsupported Check credentials");
  }
  if (agent) {
    if ((credentials.mode === "none") !== (credentials.bindings.length === 0)) {
      fail("Execution Specification Agent credential policy is incomplete");
    }
    for (const [index, raw] of credentials.bindings.entries()) {
      const binding = record(raw, `Execution credential binding ${index}`);
      exactKeys(binding, ["id", "policyDigest"], `Execution credential binding ${index}`);
      if (text(binding.id, `Execution credential binding ${index} identity`).length > 512) {
        fail("Execution credential binding identity exceeds its bound");
      }
      exactDigest(binding.policyDigest, `Execution credential binding ${index} digest`);
    }
  }

  const limits = record(specification.limits, "Execution Specification limits");
  exactKeys(limits, [
    "events",
    "outputBytes",
    "outputEntries",
    "outputEntryBytes",
    "processes",
    "storageBytes",
    "wallTimeMilliseconds",
  ], "Execution Specification limits");
  const wallTime = integer(limits.wallTimeMilliseconds, "Execution wall-time limit");
  const processes = integer(limits.processes, "Execution process limit");
  const storage = integer(limits.storageBytes, "Execution storage limit");
  const outputEntries = integer(limits.outputEntries, "Execution output-entry limit");
  const outputBytes = integer(limits.outputBytes, "Execution output-byte limit");
  const outputEntryBytes = integer(limits.outputEntryBytes, "Execution output-entry byte limit");
  const events = integer(limits.events, "Execution event limit");
  if ([wallTime, processes, storage, outputEntries, outputBytes, outputEntryBytes, events].some((value) => value < 1) ||
      storage > 10_737_418_240 || outputEntries > 100_000 || outputBytes > 1_073_741_824 ||
      outputEntryBytes > 268_435_456 || outputEntryBytes > outputBytes) {
    fail("Execution Specification limits exceed the fixed Cell runner bounds");
  }
  if (!agent && (storage > 256 * 1024 * 1024 || outputEntries > 3 ||
      outputBytes > 32 * 1024 * 1024 || outputEntryBytes > 16 * 1024 * 1024)) {
    fail("Execution Specification limits exceed the fixed Check Cell profile");
  }

  const output = record(specification.outputContract, "Execution output contract");
  exactKeys(output, [
    "allowedModeClasses",
    "declaredOutputRoots",
    "digest",
    "extraEntriesAllowed",
    "manifestProfile",
  ], "Execution output contract");
  if (!Array.isArray(output.allowedModeClasses) || !Array.isArray(output.declaredOutputRoots)) {
    fail("Execution output contract collections are invalid");
  }
  const expectedRootCount = agent && operation.role === "builder" ? 4 : agent ? 3 : 2;
  if (output.manifestProfile !== OUTPUT_MANIFEST_SCHEMA || output.extraEntriesAllowed !== false ||
      canonical(output.allowedModeClasses) !== canonical(["regular", "executable"]) ||
      output.digest !== selfDigest(output) ||
      output.declaredOutputRoots.length !== expectedRootCount) {
    fail("Execution output contract failed its fixed identity");
  }
  const expectedRoots = agent
    ? new Map<string, Readonly<{
        purpose: string;
        required: boolean;
        allowedModeClasses: readonly string[];
        maximumEntries: number | null;
      }>>([
        ["provider-terminal", Object.freeze({
          purpose: "operational-artifact",
          required: true,
          allowedModeClasses: Object.freeze(["regular"]),
          maximumEntries: 1,
        })],
        ["provider-result", Object.freeze({
          purpose: "raw-provider-output",
          required: false,
          allowedModeClasses: Object.freeze(["regular"]),
          maximumEntries: 1,
        })],
        ["agent-work-product", Object.freeze({
          purpose: "agent-work-product",
          required: false,
          allowedModeClasses: Object.freeze(["regular"]),
          maximumEntries: 1,
        })],
        ...(operation.role === "builder"
          ? [["candidate-output", Object.freeze({
              purpose: "candidate-output",
              required: false,
              allowedModeClasses: Object.freeze(["regular", "executable"]),
              maximumEntries: null,
            })] as const]
          : []),
      ])
    : new Map<string, Readonly<{
        purpose: string;
        required: boolean;
        allowedModeClasses: readonly string[];
        maximumEntries: number | null;
      }>>([
        ["check-proof", Object.freeze({
          purpose: "check-proof",
          required: true,
          allowedModeClasses: Object.freeze(["regular"]),
          maximumEntries: 1,
        })],
        ["raw-check-output", Object.freeze({
          purpose: "raw-check-output",
          required: true,
          allowedModeClasses: Object.freeze(["regular"]),
          maximumEntries: 1,
        })],
      ]);
  for (const [index, value] of output.declaredOutputRoots.entries()) {
    const root = record(value, `Execution output root ${index}`);
    exactKeys(root, [
      "allowedModeClasses",
      "maximumBytes",
      "maximumEntries",
      "path",
      "purpose",
      "required",
    ], `Execution output root ${index}`);
    if (!Array.isArray(root.allowedModeClasses)) {
      fail("Execution Specification output-root mode classes are invalid");
    }
    const path = safeRelativePath(text(root.path, `Execution output root ${index} path`),
      `Execution output root ${index} path`);
    const expected = expectedRoots.get(path);
    const rootEntries = integer(root.maximumEntries, `Execution output root ${index} entries`);
    const rootBytes = integer(root.maximumBytes, `Execution output root ${index} bytes`);
    if (expected === undefined || expected.purpose !== root.purpose ||
        expected.required !== root.required ||
        canonical(root.allowedModeClasses) !== canonical(expected.allowedModeClasses as Json) ||
        (expected.maximumEntries === null
          ? rootEntries < 1 || rootEntries > outputEntries
          : rootEntries !== expected.maximumEntries) ||
        rootBytes < 1 || rootBytes > outputBytes || rootBytes > storage ||
        ((path === "provider-result" || path === "provider-terminal") &&
          rootBytes > 64 * 1024)) {
      fail(`Execution Specification output root differs from the fixed ${agent ? "Agent" : "Check"} contract`);
    }
    expectedRoots.delete(path);
  }
  if (expectedRoots.size !== 0) {
    fail(`Execution Specification is missing a fixed ${agent ? "Agent" : "Check"} output root`);
  }

  const terminal = record(specification.terminalPolicy, "Execution terminal policy");
  exactKeys(terminal, [
    "containmentRequired",
    "directObservationRequired",
    "reclamation",
    "retirementRequired",
    "retrievalAfterContainment",
  ], "Execution terminal policy");
  if (terminal.directObservationRequired !== true || terminal.containmentRequired !== true ||
      terminal.retrievalAfterContainment !== true || terminal.retirementRequired !== true ||
      terminal.reclamation !== "asynchronous-private") {
    fail("Execution Specification weakens the fixed terminal policy");
  }
}

async function validateInputSet(
  inputRoot: string,
  specification: Record<string, Json>,
): Promise<Record<string, Json>> {
  const inputSet = await boundedJson(join(inputRoot, INPUT_SET_PATH), "Execution Input Set");
  exactKeys(inputSet, [
    "aggregateByteLength",
    "contentInventoryDigest",
    "digest",
    "entries",
    "entryCount",
    "inputMaterialDigest",
    "owner",
    "runnerContractDigest",
    "schema",
    "subjects",
    "toolInventoryDigest",
  ], "Execution Input Set");
  if (inputSet.schema !== INPUT_SET_SCHEMA || inputSet.digest !== selfDigest(inputSet) ||
      !SHA256.test(text(inputSet.inputMaterialDigest, "Execution Input Set material digest")) ||
      !SHA256.test(text(inputSet.runnerContractDigest, "Execution Input Set runner digest")) ||
      !SHA256.test(text(inputSet.toolInventoryDigest, "Execution Input Set tool digest"))) {
    fail("Execution Input Set failed its exact identity");
  }
  const specificationInput = record(specification.inputSet, "Execution Specification Input Set");
  const runner = record(specification.runner, "Execution Specification runner");
  const operation = record(specification.operation, "Execution Specification operation");
  const specificationOwner = record(specification.owner, "Execution Specification owner");
  const agent = operation.kind === "agent-attempt";
  if (specificationInput.profileId !== INPUT_SET_SCHEMA ||
      specificationInput.digest !== inputSet.digest ||
      runner.contractDigest !== inputSet.runnerContractDigest) {
    fail("Execution Input Set differs from its Specification binding");
  }
  const owner = record(inputSet.owner, "Execution Input Set owner");
  if (agent) {
    exactKeys(
      owner,
      ["activityId", "attemptId", "kind", "ownerSubjectDigest", "role"],
      "Execution Input Set owner",
    );
    const attempt = record(specificationOwner.attempt, "Execution Specification Agent Attempt");
    if (owner.kind !== "agent-attempt" || owner.activityId !== specificationOwner.activityId ||
        owner.attemptId !== attempt.id || owner.role !== operation.role ||
        !SHA256.test(text(owner.ownerSubjectDigest, "Execution Input Set owner subject"))) {
      fail("Execution Input Set does not select this exact Agent operation");
    }
  } else {
    exactKeys(owner, ["activityId", "kind", "ownerSubjectDigest", "phase", "selectionId"], "Execution Input Set owner");
    if (owner.kind !== "check" || owner.activityId !== specificationOwner.activityId ||
        owner.selectionId !== operation.selectionId || owner.phase !== operation.phase ||
        !SHA256.test(text(owner.ownerSubjectDigest, "Execution Input Set owner subject"))) {
      fail("Execution Input Set does not select this exact Check operation");
    }
  }
  if (!Array.isArray(inputSet.subjects) || inputSet.subjects.length < 1 ||
      inputSet.subjects.length > 64) {
    fail("Execution Input Set subject count is invalid");
  }
  const subjects = inputSet.subjects.map((value, index) => {
    const subject = record(value, `Execution Input Set subject ${index}`);
    exactKeys(subject, ["digest", "id", "kind", "revision"], `Execution Input Set subject ${index}`);
    if (typeof subject.kind !== "string" || typeof subject.id !== "string" || subject.id.length === 0 ||
        !(subject.revision === null || (typeof subject.revision === "number" &&
          Number.isSafeInteger(subject.revision) && subject.revision >= 1)) ||
        !SHA256.test(text(subject.digest, `Execution Input Set subject ${index} digest`))) {
      fail("Execution Input Set contains an invalid subject");
    }
    return subject;
  });
  for (let index = 1; index < subjects.length; index += 1) {
    if (subjectComparison(subjects[index - 1]!, subjects[index]!) >= 0) {
      fail("Execution Input Set subjects are not in strict canonical order");
    }
  }
  const byKind = new Map<string, Record<string, Json>[]>();
  for (const subject of subjects) {
    const selected = byKind.get(String(subject.kind)) ?? [];
    selected.push(subject);
    byKind.set(String(subject.kind), selected);
  }
  const singleton = (kind: string): Record<string, Json> => {
    const selected = byKind.get(kind);
    if (selected?.length !== 1) fail(`Execution Input Set lacks one exact ${kind} subject`);
    return selected[0]!;
  };
  if (agent) {
    const singletonKinds = [
      "projection",
      "role-subject",
      "founder-direction",
      "role-brief",
      "semantic-template",
      "capability-profile",
      "provider-descriptor",
      "investment",
      "runner",
    ];
    const candidateKinds = operation.role === "reconnaissance"
      ? []
      : ["candidate-revision", "candidate-revision-carrier-manifest"];
    const allowedKinds = new Set([...singletonKinds, ...candidateKinds, "policy"]);
    for (const kind of [...singletonKinds, ...candidateKinds]) singleton(kind);
    if ((byKind.get("policy")?.length ?? 0) < 1 ||
        [...byKind.keys()].some((kind) => !allowedKinds.has(kind)) ||
        singleton("role-subject").digest !== owner.ownerSubjectDigest ||
        singleton("provider-descriptor").digest !== operation.providerDescriptorDigest ||
        singleton("capability-profile").digest !==
          record(specification.capabilities, "Execution capabilities").capabilityProfileDigest ||
        singleton("runner").digest !== runner.contractDigest) {
      fail("Execution Input Set subjects differ from their exact Agent bindings");
    }
    const policyDigests = new Set((byKind.get("policy") ?? []).map(({ digest }) => digest));
    const network = record(specification.networkPolicy, "Execution network policy");
    const credentials = record(specification.credentialPolicy, "Execution credential policy");
    const environment = specification.environment;
    if (!policyDigests.has(network.agentPolicyDigest) ||
        (network.providerPolicyDigest !== null && !policyDigests.has(network.providerPolicyDigest)) ||
        !Array.isArray(credentials.bindings) || credentials.bindings.some((raw) =>
          !policyDigests.has(record(raw, "Execution credential binding").policyDigest)) ||
        !Array.isArray(environment) || environment.some((raw) => {
          const bindingDigest = record(raw, "Execution environment entry").bindingDigest;
          return !subjects.some(({ digest }) => digest === bindingDigest) &&
            bindingDigest !== record(specification.image, "Execution Image").imageDigest &&
            bindingDigest !== record(specification.backendProfile, "Execution Backend Profile").profileDigest;
        })) {
      fail("Execution Input Set policy subjects differ from the complete Agent policy bindings");
    }
  } else {
    const phaseKinds = operation.phase === "baseline"
      ? ["product-base", "product-base-object-closure-manifest"]
      : ["candidate-revision", "candidate-revision-carrier-manifest"];
    const requiredKinds = [
      ...phaseKinds,
      "check-binding",
      "check-definition",
      "check-proof-subject",
      "runner",
    ];
    if (byKind.size !== requiredKinds.length || requiredKinds.some((kind) => !byKind.has(kind)) ||
        singleton("check-proof-subject").digest !== owner.ownerSubjectDigest ||
        singleton("check-binding").digest !== operation.bindingDigest ||
        singleton("check-definition").digest !== operation.definitionDigest ||
        singleton("runner").digest !== runner.contractDigest) {
      fail("Execution Input Set subjects differ from their exact Check bindings");
    }
  }
  if (!Array.isArray(inputSet.entries) || inputSet.entries.length < 1 ||
      inputSet.entries.length > MAXIMUM_INPUT_ENTRIES ||
      inputSet.entryCount !== inputSet.entries.length) {
    fail("Execution Input Set entry count is invalid");
  }
  const limits = record(specification.limits, "Execution Specification limits");
  const storageLimit = integer(limits.storageBytes, "Execution storage limit");
  const entries = inputSet.entries.map((value, index) => {
    const entry = record(value, `Execution Input Set entry ${index}`);
    exactKeys(entry, [
      "byteLength",
      "digest",
      "mediaType",
      "modeClass",
      "path",
      "purpose",
      "sourceSubjectDigest",
    ], `Execution Input Set entry ${index}`);
    const path = safeRelativePath(text(entry.path, `Execution Input Set entry ${index} path`),
      `Execution Input Set entry ${index} path`);
    if (path.startsWith(".lifecycle/") ||
        !(entry.modeClass === "regular" || entry.modeClass === "executable") ||
        typeof entry.mediaType !== "string" || typeof entry.purpose !== "string" ||
        !SHA256.test(text(entry.digest, `Execution Input Set entry ${index} digest`)) ||
        !SHA256.test(text(entry.sourceSubjectDigest, `Execution Input Set entry ${index} source`)) ||
        !subjects.some((subject) => subject.digest === entry.sourceSubjectDigest)) {
      fail("Execution Input Set contains an invalid entry");
    }
    const byteLength = integer(entry.byteLength, `Execution Input Set entry ${index} length`);
    if (byteLength > storageLimit) fail("Execution Input Set entry exceeds the storage bound");
    return Object.freeze({ entry, path, byteLength });
  });
  const entryByPath = new Map(entries.map((selected) => [selected.path, selected]));
  const exactAgentEntry = (input: Readonly<{
    path: string;
    purpose: string;
    mediaType: string;
    modeClass: "regular" | "executable";
    subjectKind: string;
  }>): void => {
    const selected = entryByPath.get(input.path);
    const source = singleton(input.subjectKind);
    if (selected === undefined || selected.entry.purpose !== input.purpose ||
        selected.entry.mediaType !== input.mediaType ||
        selected.entry.modeClass !== input.modeClass ||
        selected.entry.sourceSubjectDigest !== source.digest) {
      fail(`Execution Input Set lacks exact Agent member ${input.path}`);
    }
  };
  if (agent) {
    exactAgentEntry({
      path: ROLE_BRIEF_PATH,
      purpose: "role-brief",
      mediaType: "text/markdown; charset=utf-8",
      modeClass: "regular",
      subjectKind: "role-brief",
    });
    exactAgentEntry({
      path: SEMANTIC_TEMPLATE_PATH,
      purpose: "semantic-template",
      mediaType: "text/markdown; charset=utf-8",
      modeClass: "regular",
      subjectKind: "semantic-template",
    });
    const candidateRole = operation.role !== "reconnaissance";
    if (candidateRole) {
      exactAgentEntry({
        path: CARRIER_MANIFEST_PATH,
        purpose: "operation-input",
        mediaType: "application/json",
        modeClass: "regular",
        subjectKind: "candidate-revision-carrier-manifest",
      });
      exactAgentEntry({
        path: CARRIER_ARTIFACT_PATH,
        purpose: "candidate-carrier-artifact",
        mediaType: "application/octet-stream",
        modeClass: "regular",
        subjectKind: "candidate-revision-carrier-manifest",
      });
    } else if (entryByPath.has(CARRIER_MANIFEST_PATH) || entryByPath.has(CARRIER_ARTIFACT_PATH)) {
      fail("Reconnaissance Input Set contains Candidate transport members");
    }
  } else {
    const expected = operation.phase === "baseline"
      ? Object.freeze([
          Object.freeze({
            path: PRODUCT_BASE_ARTIFACT_PATH,
            purpose: "product-base-object-closure-artifact",
            source: singleton("product-base-object-closure-manifest").digest,
          }),
          Object.freeze({
            path: PRODUCT_BASE_MANIFEST_PATH,
            purpose: "check-input",
            source: singleton("product-base-object-closure-manifest").digest,
          }),
          Object.freeze({
            path: PRODUCT_BASE_SUBJECT_PATH,
            purpose: "check-input",
            source: singleton("product-base").digest,
          }),
        ])
      : Object.freeze([
          Object.freeze({
            path: CARRIER_ARTIFACT_PATH,
            purpose: "candidate-carrier-artifact",
            source: singleton("candidate-revision-carrier-manifest").digest,
          }),
          Object.freeze({
            path: CARRIER_MANIFEST_PATH,
            purpose: "check-input",
            source: singleton("candidate-revision-carrier-manifest").digest,
          }),
        ]);
    for (const required of expected) {
      const selected = entryByPath.get(required.path);
      if (selected === undefined || selected.entry.purpose !== required.purpose ||
          selected.entry.sourceSubjectDigest !== required.source) {
        fail("Execution Input Set lacks exact phase-specific Check material");
      }
    }
  }
  let aggregate = 0;
  const expectedFiles = new Set<string>([INPUT_SET_PATH, ".lifecycle/specification.json"]);
  for (let index = 0; index < entries.length; index += 1) {
    const selected = entries[index]!;
    if (index > 0 && entries[index - 1]!.path >= selected.path) {
      fail("Execution Input Set entries are not in strict canonical order");
    }
    if (expectedFiles.has(selected.path)) fail("Execution Input Set repeats a reserved input path");
    expectedFiles.add(selected.path);
    aggregate += selected.byteLength;
    if (!Number.isSafeInteger(aggregate) || aggregate > storageLimit) {
      fail("Execution Input Set aggregate exceeds the storage bound");
    }
    const absolute = resolve(inputRoot, selected.path);
    if (!within(inputRoot, absolute)) fail("Execution Input Set entry escaped the input root");
    const observed = await digestFile(absolute, selected.byteLength, `Execution Input Set entry ${selected.path}`);
    const state = await lstat(absolute);
    const mode = (state.mode & 0o111) === 0 ? "regular" : "executable";
    if (observed.byteLength !== selected.byteLength || observed.digest !== selected.entry.digest ||
        mode !== selected.entry.modeClass) {
      fail(`Execution Input Set entry ${selected.path} differs from its descriptor`);
    }
  }
  if (aggregate !== inputSet.aggregateByteLength ||
      inputSet.contentInventoryDigest !== sha256(canonical(inputSet.entries))) {
    fail("Execution Input Set derived inventory is invalid");
  }
  await exactFileTree({
    root: inputRoot,
    expectedFiles,
    maximumEntries: MAXIMUM_INPUT_ENTRIES + 64,
    label: "Execution input root",
  });
  return inputSet;
}

async function run(input: Readonly<{
  executable: string;
  arguments: readonly string[];
  cwd: string;
  environment: Readonly<Record<string, string>>;
  stdin?: Uint8Array;
  timeoutMs: number;
  maximumStdoutBytes: number;
  maximumStderrBytes: number;
}>): Promise<Readonly<{
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}>> {
  return await new Promise((resolveResult) => {
    const startedAt = new Date().toISOString();
    let child;
    try {
      child = spawn(input.executable, [...input.arguments], {
        cwd: input.cwd,
        env: { ...input.environment },
        shell: false,
        stdio: [input.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch {
      fail("Check executable could not start");
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    timeout.unref();
    if (input.stdin !== undefined) {
      child.stdin!.once("error", () => undefined);
      child.stdin!.end(Buffer.from(input.stdin));
    }
    const capture = (
      target: Buffer[],
      chunk: Buffer,
      selectedBytes: number,
      maximum: number,
    ): Readonly<{ bytes: number; truncated: boolean }> => {
      const remaining = Math.max(0, maximum - selectedBytes);
      if (remaining > 0) target.push(Buffer.from(chunk.subarray(0, remaining)));
      return Object.freeze({
        bytes: selectedBytes + Math.min(chunk.byteLength, remaining),
        truncated: chunk.byteLength > remaining,
      });
    };
    child.stdout!.on("data", (chunk: Buffer) => {
      const next = capture(stdout, chunk, stdoutBytes, input.maximumStdoutBytes);
      stdoutBytes = next.bytes;
      stdoutTruncated ||= next.truncated;
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      const next = capture(stderr, chunk, stderrBytes, input.maximumStderrBytes);
      stderrBytes = next.bytes;
      stderrTruncated ||= next.truncated;
    });
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(Object.freeze({
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode,
        signal,
        timedOut,
        stdout: Uint8Array.from(Buffer.concat(stdout)),
        stderr: Uint8Array.from(Buffer.concat(stderr)),
        stdoutTruncated,
        stderrTruncated,
      }));
    };
    child.once("error", () => finish(null, null));
    child.once("close", finish);
  });
}

async function git(
  arguments_: readonly string[],
  cwd = "/",
  maximumStdoutBytes = 1024 * 1024,
): Promise<string> {
  const result = await run({
    executable: "/usr/bin/git",
    arguments: arguments_,
    cwd,
    environment: Object.freeze({
      HOME: "/tmp/lifecycle-home",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin:/bin",
      TZ: "UTC",
    }),
    timeoutMs: 120_000,
    maximumStdoutBytes,
    maximumStderrBytes: 1024 * 1024,
  });
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.stdoutTruncated || result.stderrTruncated) {
    fail("Check subject object closure could not be materialized exactly");
  }
  return Buffer.from(result.stdout).toString("utf8");
}

function validateObjectInventory(
  manifest: Record<string, Json>,
  objectFormat: "sha1" | "sha256",
  maximumBytes: number,
): readonly Readonly<{ objectId: string; objectType: "blob" | "tree"; byteLength: number }>[] {
  if (!Array.isArray(manifest.objectInventory)) fail("Check subject object inventory is invalid");
  const oid = new RegExp(objectFormat === "sha1" ? "^[a-f0-9]{40}$" : "^[a-f0-9]{64}$", "u");
  let aggregate = 0;
  let previous: string | null = null;
  const inventory = manifest.objectInventory.map((value, index) => {
    const entry = record(value, `Check subject object ${index}`);
    exactKeys(entry, ["byteLength", "objectId", "objectType"], `Check subject object ${index}`);
    const objectId = text(entry.objectId, `Check subject object ${index} identity`);
    const objectType = entry.objectType;
    const byteLength = integer(entry.byteLength, `Check subject object ${index} length`);
    if (!oid.test(objectId) || !(objectType === "blob" || objectType === "tree") ||
        previous !== null && previous >= objectId) {
      fail("Check subject object inventory is not exact and strictly ordered");
    }
    aggregate += byteLength;
    if (!Number.isSafeInteger(aggregate) || aggregate > maximumBytes) {
      fail("Check subject object inventory exceeds its byte bound");
    }
    previous = objectId;
    return Object.freeze({ objectId, objectType, byteLength });
  });
  if (inventory.length < 1 || inventory.length !== integer(manifest.objectCount, "Check subject object count") ||
      aggregate !== integer(manifest.aggregateObjectBytes, "Check subject aggregate object bytes") ||
      manifest.objectInventoryDigest !== sha256(canonical(manifest.objectInventory))) {
    fail("Check subject object inventory derived fields are invalid");
  }
  return Object.freeze(inventory);
}

async function materializeCheckSubject(
  inputRoot: string,
  workingRoot: string,
  maximumBytes: number,
  phase: "baseline" | "final",
  proofSubjectDigest: string,
  destinationRoot?: string,
): Promise<string> {
  const baseline = phase === "baseline";
  const manifestPath = baseline ? PRODUCT_BASE_MANIFEST_PATH : CARRIER_MANIFEST_PATH;
  const artifactPath = baseline ? PRODUCT_BASE_ARTIFACT_PATH : CARRIER_ARTIFACT_PATH;
  const manifest = await boundedJson(
    join(inputRoot, manifestPath),
    baseline ? "Product-base object-closure manifest" : "Candidate Carrier manifest",
    Math.min(MAXIMUM_CONTROL_BYTES, maximumBytes),
  );
  exactKeys(
    manifest,
    baseline
      ? [
          "aggregateObjectBytes", "allowedTreeModes", "artifact", "baseCommit", "digest",
          "objectCount", "objectFormat", "objectInventory", "objectInventoryDigest",
          "productBaseDigest", "rootTree", "schema",
        ]
      : [
          "aggregateObjectBytes", "allowedTreeModes", "carrierArtifact", "digest",
          "objectCount", "objectFormat", "objectInventory", "objectInventoryDigest",
          "rootTree", "schema",
        ],
    baseline ? "Product-base object-closure manifest" : "Candidate Carrier manifest",
  );
  const rootTree = text(manifest.rootTree, "Candidate Carrier root tree");
  if (!Array.isArray(manifest.allowedTreeModes)) {
    fail("Check subject allowed tree modes are invalid");
  }
  if (manifest.schema !== (baseline
        ? "lifecycle.check-product-base-object-closure.v1"
        : "lifecycle.candidate-revision-carrier-manifest.v1") ||
      manifest.digest !== selfDigest(manifest) ||
      !(manifest.objectFormat === "sha1" || manifest.objectFormat === "sha256") ||
      !new RegExp(manifest.objectFormat === "sha1" ? "^[a-f0-9]{40}$" : "^[a-f0-9]{64}$", "u").test(rootTree) ||
      canonical(manifest.allowedTreeModes) !== canonical(["040000", "100644", "100755"]) ||
      integer(manifest.aggregateObjectBytes, "Candidate Carrier aggregate bytes") > maximumBytes) {
    fail("Check subject object-closure manifest failed its exact bounded identity");
  }
  const objectFormat = manifest.objectFormat;
  const inventory = validateObjectInventory(manifest, objectFormat, maximumBytes);
  if (baseline) {
    const productBase = await boundedJson(
      join(inputRoot, PRODUCT_BASE_SUBJECT_PATH),
      "Product-base subject",
    );
    exactKeys(productBase, ["commit", "objectFormat", "proofSubjectDigest", "schema", "tree"], "Product-base subject");
    const oid = new RegExp(objectFormat === "sha1" ? "^[a-f0-9]{40}$" : "^[a-f0-9]{64}$", "u");
    if (productBase.schema !== "lifecycle.check-product-base.v1" ||
        productBase.objectFormat !== objectFormat || productBase.tree !== rootTree ||
        productBase.commit !== manifest.baseCommit || !oid.test(text(productBase.commit, "Product-base commit")) ||
        productBase.proofSubjectDigest !== proofSubjectDigest) {
      fail("Product-base subject differs from its object-closure manifest");
    }
    const subjectBytes = await readFile(join(inputRoot, PRODUCT_BASE_SUBJECT_PATH));
    if (manifest.productBaseDigest !== sha256(subjectBytes)) {
      fail("Product-base object-closure manifest changes its exact logical subject");
    }
  }
  const artifact = record(
    baseline ? manifest.artifact : manifest.carrierArtifact,
    "Check subject object-closure artifact",
  );
  exactKeys(artifact, ["byteLength", "digest", "format"], "Check subject object-closure artifact");
  const artifactLength = integer(artifact.byteLength, "Check subject object-closure artifact length");
  const artifactDigest = text(artifact.digest, "Check subject object-closure artifact digest");
  if (artifact.format !== "git-pack-v2" || artifactLength < 1 || artifactLength > maximumBytes ||
      !SHA256.test(artifactDigest)) {
    fail("Check subject object-closure artifact descriptor is invalid");
  }
  const observedPack = await digestFile(
    join(inputRoot, artifactPath),
    maximumBytes,
    "Check subject object-closure artifact",
  );
  if (observedPack.byteLength !== artifactLength || observedPack.digest !== artifactDigest) {
    fail("Check subject object-closure artifact differs from its manifest");
  }
  const repository = join(workingRoot, "repository.git");
  const subjectRoot = destinationRoot ?? join(workingRoot, "subject");
  await mkdir(repository, { recursive: false, mode: 0o700 });
  await mkdir(subjectRoot, { recursive: false, mode: 0o700 });
  await mkdir(join(repository, "objects", "pack"), { recursive: true, mode: 0o700 });
  await mkdir("/tmp/lifecycle-home", { recursive: true, mode: 0o700 });
  await git(["init", "--bare", `--object-format=${objectFormat}`, repository]);
  const pack = await readFile(join(inputRoot, artifactPath));
  if (pack.byteLength !== observedPack.byteLength || sha256(pack) !== observedPack.digest) {
    fail("Check subject object-closure artifact differs from its manifest");
  }
  const installedPack = join(repository, "objects", "pack", "carrier.pack");
  await writeFile(installedPack, pack, { mode: 0o600 });
  await git(["--git-dir", repository, "-c", "pack.writeReverseIndex=false", "index-pack", "--strict", "--index-version=2", installedPack]);
  const maximumInventoryOutput = Math.min(
    256 * 1024 * 1024,
    inventory.length * ((objectFormat === "sha1" ? 40 : 64) + 48) + 1,
  );
  const observedInventory = (await git([
    "--git-dir", repository,
    "cat-file",
    "--batch-all-objects",
    "--batch-check=%(objectname) %(objecttype) %(objectsize)",
  ], "/", maximumInventoryOutput)).trim().split("\n").filter((line) => line.length > 0)
    .map((line) => {
      const match = /^([a-f0-9]+) (blob|tree) ([0-9]+)$/u.exec(line);
      if (match === null) fail("Check subject object inventory could not be independently parsed");
      return Object.freeze({
        objectId: match[1]!,
        objectType: match[2]! as "blob" | "tree",
        byteLength: Number(match[3]!),
      });
    })
    .sort((left, right) => left.objectId < right.objectId ? -1 : left.objectId > right.objectId ? 1 : 0);
  if (canonical(observedInventory as unknown as Json) !== canonical(inventory as unknown as Json)) {
    fail("Check subject object-closure artifact differs from its exact inventory");
  }
  await git(["--git-dir", repository, "fsck", "--strict", "--full", "--no-reflogs", rootTree]);
  await git(["--git-dir", repository, `--work-tree=${subjectRoot}`, "read-tree", rootTree]);
  await git(["--git-dir", repository, `--work-tree=${subjectRoot}`, "checkout-index", "--all", "--force"]);
  return subjectRoot;
}

type InventoryEntry = Readonly<{ path: string; mode: "regular" | "executable"; bytes: number; digest: Sha256 }>;

async function inventory(
  root: string,
  maximumBytes: number,
): Promise<Readonly<{ entries: readonly InventoryEntry[]; digest: Sha256 }>> {
  const entries: InventoryEntry[] = [];
  let aggregateBytes = 0;
  let observedEntries = 0;
  const visit = async (directory: string): Promise<void> => {
    const selected: Array<Readonly<{ name: string; directory: boolean; file: boolean }>> = [];
    const opened = await opendir(directory);
    for await (const name of opened) {
      observedEntries += 1;
      if (observedEntries > MAXIMUM_CANDIDATE_ENTRIES) {
        fail("Candidate materialization exceeds its entry bound");
      }
      selected.push(Object.freeze({
        name: name.name,
        directory: name.isDirectory(),
        file: name.isFile(),
      }));
    }
    selected.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const name of selected) {
      const path = join(directory, name.name);
      if (name.directory) { await visit(path); continue; }
      if (!name.file) fail("Candidate materialization contains a special entry");
      const state = await lstat(path);
      const observed = await digestFile(
        path,
        maximumBytes - aggregateBytes,
        "Candidate materialization entry",
      );
      aggregateBytes += observed.byteLength;
      if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > maximumBytes) {
        fail("Candidate materialization exceeds its byte bound");
      }
      entries.push(Object.freeze({
        path: relative(root, path).split(sep).join("/"),
        mode: (state.mode & 0o111) === 0 ? "regular" : "executable",
        bytes: observed.byteLength,
        digest: observed.digest,
      }));
    }
  };
  await visit(root);
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return Object.freeze({ entries: Object.freeze(entries), digest: sha256(canonical(entries as unknown as Json)) });
}

function bindingEnvironment(binding: Record<string, Json>): Readonly<Record<string, string>> {
  const supplied = record(binding.environment, "Check environment");
  const protectedNames = new Set(["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "TZ"]);
  const environment: Record<string, string> = {
    HOME: "/tmp/lifecycle-home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    TMPDIR: "/tmp",
    TZ: "UTC",
  };
  for (const [name, value] of Object.entries(supplied)) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/u.test(name) || protectedNames.has(name) || typeof value !== "string" || value.includes("\0")) {
      fail("Check Binding environment is invalid or overrides a protected name");
    }
    environment[name] = value;
  }
  return Object.freeze(environment);
}

async function writeOutput(input: Readonly<{
  outputRoot: string;
  specification: Record<string, Json>;
  proof: Record<string, Json>;
  stdout: Uint8Array;
  stderr: Uint8Array;
}>): Promise<void> {
  await mkdir(join(input.outputRoot, "check-proof"), { recursive: true, mode: 0o700 });
  await mkdir(join(input.outputRoot, "raw-check-output"), { recursive: true, mode: 0o700 });
  await mkdir(join(input.outputRoot, ".lifecycle"), { recursive: true, mode: 0o700 });
  const proofBytes = Buffer.from(`${canonical(input.proof)}\n`, "utf8");
  const rawBytes = Buffer.from(`${canonical({
    schema: "lifecycle.check-cell-raw-streams.v1",
    stdoutBase64: Buffer.from(input.stdout).toString("base64"),
    stderrBase64: Buffer.from(input.stderr).toString("base64"),
  })}\n`, "utf8");
  const values = [
    { path: PROOF_PATH, purpose: "check-proof", mediaType: "application/json", bytes: proofBytes },
    { path: RAW_STREAMS_PATH, purpose: "raw-check-output", mediaType: "application/json", bytes: rawBytes },
  ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  for (const value of values) {
    const path = resolve(input.outputRoot, value.path);
    if (!within(input.outputRoot, path)) fail("Output path escaped the fixed root");
    await writeFile(path, value.bytes, { mode: 0o600 });
    await chmod(path, 0o600);
  }
  const entries = values.map((value) => Object.freeze({
    path: value.path,
    entryKind: "file",
    purpose: value.purpose,
    mediaType: value.mediaType,
    modeClass: "regular",
    byteLength: value.bytes.byteLength,
    digest: sha256(value.bytes),
  }));
  const outputContract = record(input.specification.outputContract, "Execution output contract");
  const runner = record(input.specification.runner, "Execution runner");
  const inputSet = record(input.specification.inputSet, "Execution Input Set reference");
  const image = record(input.specification.image, "Execution Image reference");
  const manifestSubject: Record<string, Json> = {
    schema: OUTPUT_MANIFEST_SCHEMA,
    specificationDigest: text(input.specification.digest, "Execution Specification digest"),
    inputSetDigest: text(inputSet.digest, "Execution Input Set digest"),
    imageDigest: text(image.imageDigest, "Execution Image digest"),
    outputContractDigest: text(outputContract.digest, "Execution output contract digest"),
    runnerDigest: text(runner.contractDigest, "Cell runner digest"),
    completedAt: new Date().toISOString(),
    entries: entries as unknown as Json,
    entryCount: entries.length,
    aggregateByteLength: values.reduce((sum, value) => sum + value.bytes.byteLength, 0),
    entryInventoryDigest: sha256(canonical(entries as unknown as Json)),
  };
  const manifest: Record<string, Json> = { ...manifestSubject, digest: selfDigest(manifestSubject) };
  await writeFile(join(input.outputRoot, OUTPUT_MANIFEST_PATH), `${canonical(manifest)}\n`, { mode: 0o600 });
}

type AgentProviderSupport = Readonly<{
  specificationDigest: Sha256;
  attemptDigest: Sha256;
  providerDescriptorDigest: Sha256;
  adapterImplementationDigest: Sha256;
  executableIdentity: Sha256;
  codexVersion: string;
  model: string;
  reasoning: string;
  credentialBinding: Readonly<{ id: string; policyDigest: Sha256 }>;
}>;

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch { return false; }
}

async function receiveAgentProviderSupport(): Promise<void> {
  const maximum = PROVIDER_SUPPORT_FRAME_MAGIC.byteLength + 8 +
    MAXIMUM_PROVIDER_SUPPORT_BYTES + MAXIMUM_PROVIDER_AUTH_BYTES;
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const raw of process.stdin) {
    if (!(raw instanceof Uint8Array) || raw.byteLength === 0) {
      fail("Agent provider support receiver read an invalid private frame");
    }
    byteLength += raw.byteLength;
    if (!Number.isSafeInteger(byteLength) || byteLength > maximum) {
      fail("Agent provider support receiver exceeded its private frame bound");
    }
    chunks.push(Buffer.from(raw));
  }
  const frame = Buffer.concat(chunks);
  const headerBytes = PROVIDER_SUPPORT_FRAME_MAGIC.byteLength + 8;
  if (frame.byteLength < headerBytes ||
      Buffer.compare(
        frame.subarray(0, PROVIDER_SUPPORT_FRAME_MAGIC.byteLength),
        PROVIDER_SUPPORT_FRAME_MAGIC,
      ) !== 0) {
    frame.fill(0);
    fail("Agent provider support receiver rejected its private frame identity");
  }
  const supportLength = frame.readUInt32BE(PROVIDER_SUPPORT_FRAME_MAGIC.byteLength);
  const authLength = frame.readUInt32BE(PROVIDER_SUPPORT_FRAME_MAGIC.byteLength + 4);
  if (supportLength < 2 || supportLength > MAXIMUM_PROVIDER_SUPPORT_BYTES ||
      authLength < 2 || authLength > MAXIMUM_PROVIDER_AUTH_BYTES ||
      headerBytes + supportLength + authLength !== frame.byteLength) {
    frame.fill(0);
    fail("Agent provider support receiver rejected its private frame bounds");
  }
  const supportBytes = Buffer.from(frame.subarray(headerBytes, headerBytes + supportLength));
  const authBytes = Buffer.from(frame.subarray(headerBytes + supportLength));
  frame.fill(0);
  let support: Record<string, Json>;
  try { support = record(JSON.parse(supportBytes.toString("utf8")), "Agent provider support"); }
  catch {
    authBytes.fill(0);
    supportBytes.fill(0);
    fail("Agent provider support receiver rejected non-JSON support");
  }
  if (support.schema !== PROVIDER_SUPPORT_SCHEMA || support.digest !== selfDigest(support) ||
      Buffer.compare(supportBytes, Buffer.from(`${canonical(support)}\n`, "utf8")) !== 0) {
    authBytes.fill(0);
    supportBytes.fill(0);
    fail("Agent provider support receiver rejected noncanonical support");
  }
  await mkdir(PROVIDER_SUPPORT_ROOT, { recursive: false, mode: 0o700 });
  try {
    // support.json is the readiness commit and is written last. An interrupted
    // receiver therefore cannot be mistaken for one complete private channel.
    await writeFile(PROVIDER_AUTH_PATH, authBytes, { flag: "wx", mode: 0o600 });
    await chmod(PROVIDER_AUTH_PATH, 0o600);
    await writeFile(PROVIDER_SUPPORT_PATH, supportBytes, { flag: "wx", mode: 0o600 });
  } finally {
    authBytes.fill(0);
    supportBytes.fill(0);
  }
}

async function waitForAgentProviderSupport(
  specification: Record<string, Json>,
): Promise<AgentProviderSupport> {
  const deadline = Date.now() + PROVIDER_SUPPORT_WAIT_MILLISECONDS;
  while (!(await pathExists(PROVIDER_SUPPORT_PATH)) || !(await pathExists(PROVIDER_AUTH_PATH))) {
    if (Date.now() >= deadline) fail("Agent provider support was not delivered before its fixed readiness deadline");
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  const support = await boundedJson(
    PROVIDER_SUPPORT_PATH,
    "Agent provider support",
    MAXIMUM_PROVIDER_SUPPORT_BYTES,
  );
  exactKeys(support, [
    "adapterImplementationDigest",
    "attemptDigest",
    "codexVersion",
    "credentialBinding",
    "digest",
    "executableIdentity",
    "model",
    "providerDescriptorDigest",
    "reasoning",
    "schema",
    "specificationDigest",
  ], "Agent provider support");
  const operation = record(specification.operation, "Agent operation");
  const owner = record(specification.owner, "Agent owner");
  const attempt = record(owner.attempt, "Agent Attempt owner");
  const credentials = record(specification.credentialPolicy, "Agent credential policy");
  const network = record(specification.networkPolicy, "Agent network policy");
  const binding = record(support.credentialBinding, "Agent provider credential binding");
  exactKeys(binding, ["id", "policyDigest"], "Agent provider credential binding");
  if (support.schema !== PROVIDER_SUPPORT_SCHEMA || support.digest !== selfDigest(support) ||
      support.specificationDigest !== specification.digest || support.attemptDigest !== attempt.digest ||
      support.providerDescriptorDigest !== operation.providerDescriptorDigest ||
      support.adapterImplementationDigest !== operation.adapterImplementationDigest ||
      credentials.mode !== "fixed-runner" || credentials.agentAccess !== false ||
      credentials.outputDisclosure !== false || !Array.isArray(credentials.bindings) ||
      credentials.bindings.length !== 1 || binding.id !== "provider-control" ||
      canonical(binding) !== canonical(credentials.bindings[0] as Json) ||
      network.agentProductNetwork !== "none" ||
      network.providerControlPlane !== "fixed-service-channel" ||
      network.providerPolicyDigest === null || network.separationRequired !== true) {
    fail("Agent provider support differs from its exact authenticated Specification");
  }
  const executableIdentity = exactDigest(support.executableIdentity, "Codex executable identity");
  const codexVersion = text(support.codexVersion, "Codex version");
  const model = text(support.model, "Codex model");
  const reasoning = text(support.reasoning, "Codex reasoning effort");
  if (!/^\d+\.\d+\.\d+$/u.test(codexVersion) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(model) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(reasoning)) {
    fail("Agent provider support contains an invalid installed selection");
  }
  const bytes = await readFile(PROVIDER_SUPPORT_PATH);
  if (Buffer.compare(bytes, Buffer.from(`${canonical(support)}\n`, "utf8")) !== 0) {
    fail("Agent provider support is not canonical JSON");
  }
  return Object.freeze({
    specificationDigest: specification.digest as Sha256,
    attemptDigest: attempt.digest as Sha256,
    providerDescriptorDigest: operation.providerDescriptorDigest as Sha256,
    adapterImplementationDigest: operation.adapterImplementationDigest as Sha256,
    executableIdentity,
    codexVersion,
    model,
    reasoning,
    credentialBinding: Object.freeze({
      id: "provider-control",
      policyDigest: exactDigest(binding.policyDigest, "Agent provider credential policy"),
    }),
  });
}

async function activateAgentProviderHome(): Promise<void> {
  const before = await lstat(PROVIDER_AUTH_PATH);
  const uid = process.getuid?.();
  if (!before.isFile() || before.isSymbolicLink() || before.size < 2 ||
      before.size > MAXIMUM_PROVIDER_AUTH_BYTES || (before.mode & 0o077) !== 0 ||
      (uid !== undefined && before.uid !== uid)) {
    fail("Agent provider authentication is not one bounded private operation-scoped file");
  }
  await mkdir(PROVIDER_CODEX_HOME, { recursive: false, mode: 0o700 });
  const destination = join(PROVIDER_CODEX_HOME, "auth.json");
  await rename(PROVIDER_AUTH_PATH, destination);
  await chmod(destination, 0o600);
  const after = await lstat(destination);
  if (!after.isFile() || after.isSymbolicLink() || after.dev !== before.dev ||
      after.ino !== before.ino || after.size !== before.size ||
      (uid !== undefined && after.uid !== uid)) {
    fail("Agent provider authentication changed while it was activated");
  }
  await rm(PROVIDER_SUPPORT_PATH, { force: false });
  await rmdir(PROVIDER_SUPPORT_ROOT);
}

function agentPermissionOverrides(input: Readonly<{
  transportInputRoot: string;
  providerInputRoot: string;
  workingRoot: string;
  candidateRoot: string | null;
  candidateWritable: boolean;
  semanticRoot: string;
}>): readonly string[] {
  const filesystem = new Map<string, "read" | "write" | "deny">([
    [":minimal", "read"],
    ["/opt/lifecycle/bin", "read"],
    ["/opt/lifecycle/codex-path", "read"],
    [input.transportInputRoot, "deny"],
    [input.providerInputRoot, "read"],
    [input.workingRoot, "write"],
    [input.semanticRoot, "write"],
    [PROVIDER_CODEX_HOME, "deny"],
    [PROVIDER_SUPPORT_ROOT, "deny"],
  ]);
  if (input.candidateRoot !== null) {
    filesystem.set(input.candidateRoot, input.candidateWritable ? "write" : "read");
  }
  return Object.freeze([
    'default_permissions="lifecycle"',
    "permissions.lifecycle.network.enabled=false",
    `permissions.lifecycle.filesystem={${[...filesystem.entries()]
      .map(([path, access]) => `${JSON.stringify(path)}=${JSON.stringify(access)}`).join(",")}}`,
    'shell_environment_policy.inherit="core"',
    "shell_environment_policy.ignore_default_excludes=false",
    'shell_environment_policy.include_only=["PATH","HOME","LANG","LC_ALL","TZ","LIFECYCLE_PROVIDER_INPUT"]',
    `shell_environment_policy.set={HOME="/tmp/lifecycle-agent-home",PATH="/opt/lifecycle/codex-path:/opt/lifecycle/bin:/usr/local/bin:/usr/bin:/bin",LANG="C.UTF-8",LC_ALL="C.UTF-8",TZ="UTC",LIFECYCLE_PROVIDER_INPUT=${JSON.stringify(input.providerInputRoot)}}`,
  ]);
}

export function foundationAgentCodexExecArgumentsV1(input: Readonly<{
  cwd: string;
  model: string;
  reasoning: string;
  permissionOverrides: readonly string[];
}>): readonly string[] {
  if (!input.permissionOverrides.includes('default_permissions="lifecycle"')) {
    fail("Agent invocation does not select the exact Lifecycle permission profile");
  }
  const selected = Object.freeze([
    "exec",
    "--ignore-user-config",
    "--strict-config",
    "--ephemeral",
    "--json",
    "--ignore-rules",
    "-C", input.cwd,
    "--skip-git-repo-check",
    "-c", 'approval_policy="never"',
    "-c", "mcp_servers={}",
    "--disable", "apps",
    "--disable", "plugins",
    "--disable", "remote_plugin",
    ...input.permissionOverrides.flatMap((value) => ["-c", value]),
    "-m", input.model,
    "-c", `model_reasoning_effort=${JSON.stringify(input.reasoning)}`,
    "-",
  ]);
  if (selected.includes("-s") || selected.includes("--sandbox")) {
    fail("Agent invocation cannot combine the Lifecycle permission profile with another sandbox selection");
  }
  return selected;
}

async function assertAgentToolIsolation(input: Readonly<{
  cwd: string;
  providerInputRoot: string;
  transportInputRoot: string;
  semanticRoot: string;
  environment: Readonly<Record<string, string>>;
  permissionOverrides: readonly string[];
  timeoutMs: number;
}>): Promise<void> {
  const server = createServer(() => undefined);
  const port = await new Promise<number>((resolvePort, rejectPort) => {
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") rejectPort(new Error("address"));
      else resolvePort(address.port);
    });
  }).catch(() => fail("Agent sandbox isolation probe could not establish its private loopback witness"));
  const writeProbePath = join(input.semanticRoot, ".lifecycle-sandbox-write-probe");
  const script = [
    'const fs=require("node:fs"),net=require("node:net");',
    'const allowed=new Set(["CODEX_SANDBOX_NETWORK_DISABLED","HOME","LANG","LC_ALL","LIFECYCLE_PROVIDER_INPUT","PATH","PWD","TZ"]);',
    'if(Object.keys(process.env).some((key)=>!allowed.has(key))||process.env.CODEX_HOME!==undefined||process.env.LIFECYCLE_CREDENTIAL_CANARY!==undefined)process.exit(91);',
    `if(process.env.LIFECYCLE_PROVIDER_INPUT!==${JSON.stringify(input.providerInputRoot)})process.exit(92);`,
    `try{fs.readFileSync(${JSON.stringify(join(PROVIDER_CODEX_HOME, "auth.json"))});process.exit(93)}catch(error){if(!["EACCES","EPERM","ENOENT"].includes(error.code))process.exit(94)}`,
    `try{if(fs.readFileSync(${JSON.stringify(join(input.providerInputRoot, ROLE_BRIEF_PATH))}).length===0)process.exit(95)}catch{process.exit(95)}`,
    `for(const path of ${JSON.stringify([
      join(input.transportInputRoot, INPUT_SET_PATH),
      join(input.transportInputRoot, SEMANTIC_TEMPLATE_PATH),
    ])}){try{fs.readFileSync(path);process.exit(99)}catch(error){if(!["EACCES","EPERM","ENOENT"].includes(error.code))process.exit(100)}}`,
    `try{fs.writeFileSync(${JSON.stringify(join(input.providerInputRoot, ".lifecycle-write-probe"))},"forbidden",{flag:"wx",mode:0o600});process.exit(101)}catch(error){if(!${JSON.stringify(foundationAgentReadOnlyWriteDenialCodesV1)}.includes(error.code))process.exit(102)}`,
    `try{fs.writeFileSync(${JSON.stringify(writeProbePath)},"lifecycle-agent-write-probe",{flag:"wx",mode:0o600});if(fs.readFileSync(${JSON.stringify(writeProbePath)},"utf8")!=="lifecycle-agent-write-probe")process.exit(96);fs.unlinkSync(${JSON.stringify(writeProbePath)})}catch{process.exit(96)}`,
    `const socket=net.createConnection({host:"127.0.0.1",port:${port}});`,
    'socket.once("connect",()=>process.exit(97));',
    'socket.once("error",(error)=>process.exit(["EACCES","EPERM"].includes(error.code)?0:98));',
    'setTimeout(()=>process.exit(98),2000);',
  ].join("");
  try {
    const result = await run({
      executable: CODEX_EXECUTABLE,
      arguments: [
        "sandbox",
        ...input.permissionOverrides.flatMap((value) => ["-c", value]),
        "-P", "lifecycle",
        "-C", input.cwd,
        process.execPath, "-e", script,
      ],
      cwd: input.cwd,
      environment: input.environment,
      timeoutMs: Math.min(30_000, input.timeoutMs),
      maximumStdoutBytes: 64 * 1024,
      maximumStderrBytes: 64 * 1024,
    });
    if (result.exitCode !== 0 || result.signal !== null || result.timedOut ||
        result.stdoutTruncated || result.stderrTruncated) {
      fail("Current Codex Agent sandbox did not prove exact workspace access, credential separation, environment isolation, and network denial");
    }
  } finally {
    await rm(writeProbePath, { force: true });
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

async function assertInstalledCodex(support: AgentProviderSupport): Promise<void> {
  const observed = await digestFile(
    CODEX_EXECUTABLE,
    MAXIMUM_PROVIDER_EXECUTABLE_BYTES,
    "Installed Codex executable",
  );
  if (observed.digest !== support.executableIdentity) {
    fail("Installed Codex executable differs from the exact Provider selection");
  }
  const result = await run({
    executable: CODEX_EXECUTABLE,
    arguments: ["--version"],
    cwd: "/tmp",
    environment: Object.freeze({
      HOME: "/tmp/lifecycle-agent-parent-home",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/opt/lifecycle/codex-path:/opt/lifecycle/bin:/usr/local/bin:/usr/bin:/bin",
      TZ: "UTC",
    }),
    timeoutMs: 30_000,
    maximumStdoutBytes: 4096,
    maximumStderrBytes: 4096,
  });
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut ||
      result.stdoutTruncated || result.stderrTruncated ||
      Buffer.from(result.stdout).toString("utf8").trim() !== `codex-cli ${support.codexVersion}`) {
    fail("Installed Codex version differs from the exact Provider selection");
  }
}

async function exactUtf8Input(path: string, maximumBytes: number, label: string): Promise<string> {
  const observed = await digestFile(path, maximumBytes, label);
  const bytes = await readFile(path);
  if (bytes.byteLength !== observed.byteLength || sha256(bytes) !== observed.digest) {
    fail(`${label} changed while it was reopened`);
  }
  const value = bytes.toString("utf8");
  if (value.includes("\0") || Buffer.compare(Buffer.from(value, "utf8"), bytes) !== 0) {
    fail(`${label} is not exact UTF-8 text`);
  }
  return value;
}

async function stableInputBytes(input: Readonly<{
  path: string;
  byteLength: number;
  digest: Sha256;
  label: string;
}>): Promise<Buffer> {
  const before = await lstat(input.path);
  if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o111) !== 0 ||
      before.size !== input.byteLength) {
    fail(`${input.label} is not one exact non-executable regular file`);
  }
  const bytes = await readFile(input.path);
  const after = await lstat(input.path);
  if (!after.isFile() || after.isSymbolicLink() || bytes.byteLength !== input.byteLength ||
      sha256(bytes) !== input.digest || after.dev !== before.dev || after.ino !== before.ino ||
      after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs) {
    bytes.fill(0);
    fail(`${input.label} changed while it was materialized`);
  }
  return bytes;
}

export async function materializeFoundationAgentProviderVisibleInputV1(input: Readonly<{
  transportInputRoot: string;
  inputSet: Record<string, Json>;
  destinationRoot: string;
}>): Promise<string> {
  const inputRoot = input.transportInputRoot;
  const inputSet = input.inputSet;
  const destinationRoot = input.destinationRoot;
  if (await pathExists(destinationRoot)) {
    fail("Agent provider-visible input root already exists");
  }
  if (!Array.isArray(inputSet.entries)) fail("Execution Input Set entries are unavailable");
  const selected = inputSet.entries.map((value, index) => {
    const entry = record(value, `Execution Input Set entry ${index}`);
    const purpose = text(entry.purpose, `Execution Input Set entry ${index} purpose`);
    if (purpose !== "role-brief" && purpose !== "projection") return null;
    const path = safeRelativePath(
      text(entry.path, `Execution Input Set entry ${index} path`),
      `Execution Input Set entry ${index} path`,
    );
    if ((purpose === "role-brief" && path !== ROLE_BRIEF_PATH) ||
        (purpose === "projection" && !path.startsWith("sources/")) ||
        entry.modeClass !== "regular") {
      fail("Execution Input Set contains an invalid provider-visible entry");
    }
    return Object.freeze({
      path,
      byteLength: integer(entry.byteLength, `Execution Input Set entry ${index} length`),
      digest: exactDigest(entry.digest, `Execution Input Set entry ${index} digest`),
    });
  }).filter((value): value is Readonly<{
    path: string;
    byteLength: number;
    digest: Sha256;
  }> => value !== null);
  if (selected.filter(({ path }) => path === ROLE_BRIEF_PATH).length !== 1 ||
      new Set(selected.map(({ path }) => path)).size !== selected.length) {
    fail("Execution Input Set lacks one exact provider-visible Role Brief");
  }
  selected.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  await mkdir(destinationRoot, { recursive: false, mode: 0o700 });
  const directories = new Set<string>();
  for (const entry of selected) {
    const parts = entry.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  for (const directory of [...directories].sort((left, right) =>
    left.split("/").length - right.split("/").length ||
    (left < right ? -1 : left > right ? 1 : 0))) {
    await mkdir(join(destinationRoot, directory), {
      recursive: false,
      mode: 0o700,
    });
  }
  for (const entry of selected) {
    const bytes = await stableInputBytes({
      path: join(inputRoot, entry.path),
      byteLength: entry.byteLength,
      digest: entry.digest,
      label: `Provider-visible input ${entry.path}`,
    });
    const destination = join(destinationRoot, entry.path);
    try {
      await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
      await chmod(destination, 0o400);
      const observed = await digestFile(
        destination,
        entry.byteLength,
        `Materialized provider-visible input ${entry.path}`,
      );
      if (observed.byteLength !== entry.byteLength || observed.digest !== entry.digest) {
        fail(`Materialized provider-visible input ${entry.path} differs from its source`);
      }
    } finally {
      bytes.fill(0);
    }
  }
  for (const directory of [...directories].sort((left, right) =>
    right.split("/").length - left.split("/").length ||
    (left < right ? -1 : left > right ? 1 : 0))) {
    await chmod(join(destinationRoot, directory), 0o500);
  }
  await chmod(destinationRoot, 0o500);
  await exactFileTree({
    root: destinationRoot,
    expectedFiles: new Set(selected.map(({ path }) => path)),
    maximumEntries: selected.length + directories.size + 1,
    label: "Agent provider-visible input root",
  });
  return destinationRoot;
}

function agentPrompt(input: Readonly<{
  role: string;
  roleBrief: string;
  providerInputRoot: string;
  candidateRoot: string | null;
  semanticPath: string;
}>): string {
  return [
    `Execute the exact Lifecycle ${input.role} Agent Attempt described by the role brief below.`,
    "The Execution Cell and its container are subordinate mechanics, not workflow authority.",
    `The curated provider-visible input is read-only at ${input.providerInputRoot}.`,
    input.candidateRoot === null
      ? "This role has no Candidate materialization."
      : `The exact Candidate materialization is at ${input.candidateRoot}.`,
    `Write the governed semantic Work Product only to ${input.semanticPath}.`,
    "Reread the governed semantic file against its supplied template before returning; the runtime validates the exact final file after Cell containment.",
    "Do not treat final prose or provider events as the Work Product. Do not attempt network access.",
    "",
    "Exact role brief:",
    input.roleBrief,
  ].join("\n");
}

function providerSessionId(stdout: Uint8Array): string | null {
  let selected: string | null = null;
  for (const line of Buffer.from(stdout).toString("utf8").split(/\r?\n/u)) {
    if (line.length === 0 || Buffer.byteLength(line, "utf8") > 256 * 1024) continue;
    let value: unknown;
    try { value = JSON.parse(line); }
    catch { continue; }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const event = value as Record<string, unknown>;
      const identity = event.thread_id ?? event.threadId;
      if ((event.type === "thread.started" || event.type === "thread_started") &&
          typeof identity === "string" && identity.length > 0 && identity.length <= 512 &&
          !identity.includes("\0")) {
        if (selected !== null && selected !== identity) fail("Provider emitted more than one session identity");
        selected = identity;
      }
    }
  }
  return selected;
}

function isPublicProviderAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    const [a, b, c] = parts as [number, number, number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6) return false;
  const normalized = address.toLowerCase().split("%")[0]!;
  if (normalized.startsWith("::ffff:")) {
    return isPublicProviderAddress(normalized.slice("::ffff:".length));
  }
  return (normalized.startsWith("2") || normalized.startsWith("3")) &&
    !normalized.startsWith("2001:db8:");
}

async function providerControlTarget(host: string): Promise<Readonly<{
  address: string;
  family: 4 | 6;
}>> {
  let addresses: Array<Readonly<{ address: string; family: 4 | 6 }>>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true }) as
      Array<Readonly<{ address: string; family: 4 | 6 }>>;
  } catch {
    return fail("Provider-control destination could not be resolved");
  }
  const selected = addresses
    .filter(({ address, family }) => (family === 4 || family === 6) &&
      isPublicProviderAddress(address))
    .sort((left, right) => left.family - right.family ||
      (left.address < right.address ? -1 : left.address > right.address ? 1 : 0))[0];
  if (selected === undefined || (selected.family !== 4 && selected.family !== 6)) {
    return fail("Provider-control destination did not resolve to one public address");
  }
  return Object.freeze({ address: selected.address, family: selected.family });
}

function closeSocket(socket: Socket): void {
  if (!socket.destroyed) socket.destroy();
}

export type FoundationProviderControlTunnelBudgetV1 = Readonly<{
  acquire(): (() => void) | null;
  retire(): void;
  observation(): Readonly<{ active: number; retiring: boolean }>;
}>;

/** Fixed proxy admission accounting. Each acquired tunnel can release once. */
export function createFoundationProviderControlTunnelBudgetV1(
  maximum = MAXIMUM_PROVIDER_CONTROL_CONNECTIONS,
): FoundationProviderControlTunnelBudgetV1 {
  if (!Number.isSafeInteger(maximum) || maximum < 1 ||
      maximum > MAXIMUM_PROVIDER_CONTROL_CONNECTIONS) {
    fail("Provider-control connection bound is invalid");
  }
  let active = 0;
  let retiring = false;
  return Object.freeze({
    acquire() {
      if (retiring || active >= maximum) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
      };
    },
    retire() {
      retiring = true;
    },
    observation() {
      return Object.freeze({ active, retiring });
    },
  });
}

async function runProviderControlProxy(input: Readonly<{
  specificationDigest: Sha256;
  providerPolicyDigest: Sha256;
  wallTimeMilliseconds: number;
}>): Promise<void> {
  const allowed = new Set<string>(PROVIDER_CONTROL_ALLOWED_DESTINATIONS);
  const sockets = new Set<Socket>();
  const budget = createFoundationProviderControlTunnelBudgetV1();
  const server = createServer((client) => {
    sockets.add(client);
    client.once("close", () => sockets.delete(client));
    client.setTimeout(input.wallTimeMilliseconds, () => closeSocket(client));
    let header = Buffer.alloc(0);
    const reject = (status = "403 Forbidden"): void => {
      if (!client.destroyed) client.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    };
    const onData = (chunk: Buffer): void => {
      if (budget.observation().retiring ||
          header.byteLength + chunk.byteLength > MAXIMUM_PROVIDER_CONTROL_HEADER_BYTES) {
        reject("413 Payload Too Large");
        return;
      }
      header = Buffer.concat([header, chunk]);
      const boundary = header.indexOf("\r\n\r\n");
      if (boundary === -1) return;
      client.off("data", onData);
      const head = header.subarray(0, boundary).toString("ascii");
      const remainder = header.subarray(boundary + 4);
      if (Buffer.from(head, "ascii").byteLength !== boundary || head.includes("\0")) {
        reject();
        return;
      }
      const lines = head.split("\r\n");
      const retirePath = `/__lifecycle_retire/${input.specificationDigest}/${input.providerPolicyDigest}`;
      if (lines[0] === `POST ${retirePath} HTTP/1.1`) {
        budget.retire();
        client.end("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
        server.close();
        for (const socket of sockets) {
          if (socket !== client) closeSocket(socket);
        }
        return;
      }
      const request = /^CONNECT ([A-Za-z0-9.-]+):443 HTTP\/1\.1$/u.exec(lines[0] ?? "");
      const destination = request?.[1]?.toLowerCase();
      const release = destination === undefined || !allowed.has(destination)
        ? null
        : budget.acquire();
      if (destination === undefined || !allowed.has(destination) || release === null ||
          lines.slice(1).some((line) => line.length === 0 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+:[\t -~]*$/u.test(line) ||
            /^proxy-authorization:/iu.test(line))) {
        release?.();
        reject();
        return;
      }
      void providerControlTarget(destination).then((target) => {
        if (client.destroyed || budget.observation().retiring) {
          release();
          return;
        }
        const upstream = connect({ host: target.address, port: 443, family: target.family });
        sockets.add(upstream);
        upstream.setTimeout(input.wallTimeMilliseconds, () => closeSocket(upstream));
        upstream.once("connect", () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (remainder.byteLength > 0) upstream.write(remainder);
          client.pipe(upstream);
          upstream.pipe(client);
        });
        let finished = false;
        const finish = (): void => {
          if (finished) return;
          finished = true;
          release();
          sockets.delete(upstream);
          closeSocket(upstream);
          closeSocket(client);
        };
        client.once("close", finish);
        upstream.once("error", finish);
        upstream.once("close", finish);
      }).catch(() => {
        release();
        reject("502 Bad Gateway");
      });
    };
    client.on("data", onData);
  });
  server.on("error", () => {
    budget.retire();
    for (const socket of sockets) closeSocket(socket);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(PROVIDER_CONTROL_PORT, "0.0.0.0", resolveListen);
  }).catch(() => fail("Provider-control proxy could not establish its fixed listener"));
  const readySubject: Record<string, Json> = {
    schema: "lifecycle.provider-control-proxy-ready.private.v1",
    specificationDigest: input.specificationDigest,
    providerPolicyDigest: input.providerPolicyDigest,
    allowedDestinations: PROVIDER_CONTROL_ALLOWED_DESTINATIONS as unknown as Json,
    protocol: "http-connect-tls-443-only",
    wallTimeMilliseconds: input.wallTimeMilliseconds,
  };
  await writeFile(PROVIDER_CONTROL_READY_PATH, `${canonical({
    ...readySubject,
    digest: selfDigest(readySubject),
  })}\n`, { flag: "wx", mode: 0o600 });
  await new Promise<void>((resolveClosed) => server.once("close", resolveClosed));
  for (const socket of sockets) closeSocket(socket);
}

async function retireProviderControlProxy(input: Readonly<{
  specificationDigest: Sha256;
  providerPolicyDigest: Sha256;
}>): Promise<void> {
  const request = [
    `POST /__lifecycle_retire/${input.specificationDigest}/${input.providerPolicyDigest} HTTP/1.1`,
    `Host: ${PROVIDER_CONTROL_HOST}:${PROVIDER_CONTROL_PORT}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n");
  await new Promise<void>((resolveRetired, rejectRetired) => {
    const socket = connect({ host: PROVIDER_CONTROL_HOST, port: PROVIDER_CONTROL_PORT });
    let response = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      closeSocket(socket);
      rejectRetired(new Error("timeout"));
    }, 5_000);
    socket.once("connect", () => socket.write(request));
    socket.on("data", (chunk: Buffer) => {
      if (response.byteLength + chunk.byteLength > 4096) {
        closeSocket(socket);
        rejectRetired(new Error("bound"));
        return;
      }
      response = Buffer.concat([response, chunk]);
    });
    socket.once("error", rejectRetired);
    socket.once("close", () => {
      clearTimeout(timeout);
      if (response.toString("ascii").startsWith("HTTP/1.1 204 ")) resolveRetired();
      else rejectRetired(new Error("response"));
    });
  }).catch(() => fail("Provider-control proxy did not prove terminal retirement"));
}

type AgentProviderTerminalFacts = Readonly<{
  preparedAt: string;
  startedAt: string | null;
  finishedAt: string;
  executableIdentity: Sha256 | null;
  outcome: "natural-return" | "invalid-result" | "timeout" | "cancelled" |
    "forced-termination" | "provider-failure" | "capability-refusal" |
    "security-stop" | "runtime-failure";
  stage: "preflight" | "compatibility" | "dispatch" | "running" |
    "result-validation" | "evaluated";
  productiveStarted: boolean;
  firstTrigger: "natural-return" | "timeout" | "cancellation" |
    "force-cancellation" | "safety-limit" | "provider-failure" |
    "capability-refusal" | "security-stop" | "runtime-failure" |
    "invalid-result";
  exitCode: number | null;
  signal: string | null;
  sessionId: string | null;
}>;

function agentProviderFacts(input: Readonly<{
  executableIdentity: Sha256;
  preparedAt: string;
  provider: Readonly<{
    startedAt: string;
    finishedAt: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    stdout: Uint8Array;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }>;
}>): AgentProviderTerminalFacts {
  const outcome = input.provider.timedOut
    ? "timeout"
    : input.provider.signal !== null
      ? "forced-termination"
      : input.provider.exitCode === 0 && !input.provider.stdoutTruncated &&
          !input.provider.stderrTruncated
        ? "natural-return"
        : input.provider.stdoutTruncated || input.provider.stderrTruncated
          ? "invalid-result"
          : "provider-failure";
  const firstTrigger = outcome === "natural-return"
    ? "natural-return"
    : outcome === "timeout"
      ? "timeout"
      : outcome === "forced-termination"
        ? "force-cancellation"
        : outcome === "invalid-result"
          ? "invalid-result"
          : "provider-failure";
  return Object.freeze({
    preparedAt: input.preparedAt,
    startedAt: input.provider.startedAt,
    finishedAt: input.provider.finishedAt,
    executableIdentity: input.executableIdentity,
    outcome,
    stage: outcome === "natural-return"
      ? "evaluated"
      : outcome === "invalid-result"
        ? "result-validation"
        : "running",
    productiveStarted: true,
    firstTrigger,
    exitCode: input.provider.exitCode,
    signal: input.provider.signal,
    sessionId: providerSessionId(input.provider.stdout),
  });
}

function agentTerminalSubject(input: Readonly<{
  specification: Record<string, Json>;
  runnerImplementationDigest: Sha256;
  facts: AgentProviderTerminalFacts;
}>): Record<string, Json> {
  const operation = record(input.specification.operation, "Agent operation");
  const owner = record(input.specification.owner, "Agent owner");
  const attempt = record(owner.attempt, "Agent Attempt owner");
  const image = record(input.specification.image, "Execution Image reference");
  const runner = record(input.specification.runner, "Execution runner");
  return {
    schema: "lifecycle.agent-execution-cell-provider-terminal-observation.private.v1",
    attemptDigest: exactDigest(attempt.digest, "Agent Attempt digest"),
    specificationDigest: exactDigest(input.specification.digest, "Execution Specification digest"),
    providerDescriptorDigest: exactDigest(
      operation.providerDescriptorDigest,
      "Provider Descriptor digest",
    ),
    adapterImplementationDigest: exactDigest(
      operation.adapterImplementationDigest,
      "Provider Adapter implementation digest",
    ),
    imageDigest: exactDigest(image.imageDigest, "Execution Image digest"),
    runnerContractDigest: exactDigest(runner.contractDigest, "Execution runner contract digest"),
    runnerImplementationDigest: input.runnerImplementationDigest,
    ...input.facts,
  };
}

async function writeAgentTerminalObservation(input: Readonly<{
  outputRoot: string;
  specification: Record<string, Json>;
  runnerImplementationDigest: Sha256;
  facts: AgentProviderTerminalFacts;
}>): Promise<Readonly<{ bytes: Uint8Array; entry: Record<string, Json> }>> {
  const subject = agentTerminalSubject(input);
  const bytes = Buffer.from(`${canonical({ ...subject, digest: selfDigest(subject) })}\n`, "utf8");
  await mkdir(join(input.outputRoot, "provider-terminal"), { recursive: false, mode: 0o700 });
  await writeFile(
    join(input.outputRoot, AGENT_PROVIDER_TERMINAL_OBSERVATION_PATH),
    bytes,
    { flag: "wx", mode: 0o600 },
  );
  return Object.freeze({
    bytes: Uint8Array.from(bytes),
    entry: {
      path: AGENT_PROVIDER_TERMINAL_OBSERVATION_PATH,
      entryKind: "file",
      purpose: "operational-artifact",
      mediaType: "application/json",
      modeClass: "regular",
      byteLength: bytes.byteLength,
      digest: sha256(bytes),
    },
  });
}

async function writeAgentManifest(input: Readonly<{
  outputRoot: string;
  specification: Record<string, Json>;
  entries: readonly Record<string, Json>[];
}>): Promise<void> {
  const entries = [...input.entries].sort((left, right) =>
    String(left.path) < String(right.path) ? -1 : String(left.path) > String(right.path) ? 1 : 0);
  const aggregate = entries.reduce((sum, entry) => sum + Number(entry.byteLength), 0);
  const limits = record(input.specification.limits, "Execution limits");
  const maximumOutputBytes = integer(limits.outputBytes, "Execution output-byte limit");
  const maximumEntryBytes = integer(limits.outputEntryBytes, "Execution output-entry byte limit");
  const maximumEntries = integer(limits.outputEntries, "Execution output-entry limit");
  if (entries.length > maximumEntries || aggregate > maximumOutputBytes ||
      entries.some((entry) => Number(entry.byteLength) > maximumEntryBytes)) {
    fail("Agent output exceeds its exact Execution Specification bounds");
  }
  const outputContract = record(input.specification.outputContract, "Execution output contract");
  const inputSet = record(input.specification.inputSet, "Execution Input Set reference");
  const image = record(input.specification.image, "Execution Image reference");
  const runner = record(input.specification.runner, "Execution runner");
  const manifestSubject: Record<string, Json> = {
    schema: OUTPUT_MANIFEST_SCHEMA,
    specificationDigest: exactDigest(input.specification.digest, "Execution Specification digest"),
    inputSetDigest: exactDigest(inputSet.digest, "Execution Input Set digest"),
    imageDigest: exactDigest(image.imageDigest, "Execution Image digest"),
    outputContractDigest: exactDigest(outputContract.digest, "Execution output contract digest"),
    runnerDigest: exactDigest(runner.contractDigest, "Execution runner contract digest"),
    completedAt: new Date().toISOString(),
    entries: entries as unknown as Json,
    entryCount: entries.length,
    aggregateByteLength: aggregate,
    entryInventoryDigest: sha256(canonical(entries as unknown as Json)),
  };
  const manifest = { ...manifestSubject, digest: selfDigest(manifestSubject) };
  const lifecycleRoot = join(input.outputRoot, ".lifecycle");
  const pendingPath = join(lifecycleRoot, "output-manifest.pending");
  await mkdir(lifecycleRoot, { recursive: false, mode: 0o700 });
  await writeFile(pendingPath, `${canonical(manifest)}\n`, { flag: "wx", mode: 0o600 });
  await rename(pendingPath, join(input.outputRoot, OUTPUT_MANIFEST_PATH));
}

async function resetAgentOutputRoot(outputRoot: string): Promise<void> {
  const allowed = new Set([
    ".lifecycle",
    "agent-work-product",
    "candidate-output",
    "provider-result",
    "provider-terminal",
  ]);
  const directory = await opendir(outputRoot);
  for await (const entry of directory) {
    if (!allowed.has(entry.name)) {
      fail("Agent output root contains an entry outside the fixed runner-owned roots");
    }
    await rm(join(outputRoot, entry.name), { recursive: true, force: false });
  }
}

/**
 * Complete a dispatched Agent Cell with one trusted terminal observation even
 * after interrupted ordinary output finalization. This clears only the exact
 * runner-owned output roots and publishes the manifest last.
 */
export async function writeFoundationAgentRunnerTerminalOutputV1(input: Readonly<{
  outputRoot: string;
  specification: FoundationExecutionSpecificationV1;
  runnerImplementationDigest: Sha256;
  facts: AgentProviderTerminalFacts;
}>): Promise<void> {
  await resetAgentOutputRoot(input.outputRoot);
  const terminal = await writeAgentTerminalObservation(input);
  await writeAgentManifest({
    outputRoot: input.outputRoot,
    specification: input.specification,
    entries: Object.freeze([terminal.entry]),
  });
}

async function writeAgentOutput(input: Readonly<{
  outputRoot: string;
  specification: Record<string, Json>;
  runnerImplementationDigest: Sha256;
  facts: AgentProviderTerminalFacts;
  semanticPath: string;
  candidateRoot: string | null;
}>): Promise<void> {
  const operation = record(input.specification.operation, "Agent operation");
  const terminalSubject = agentTerminalSubject(input);
  const { schema: _schema, imageDigest: _imageDigest,
    runnerContractDigest: _runnerContractDigest,
    runnerImplementationDigest: _runnerImplementationDigest,
    ...providerFacts } = terminalSubject;
  const providerSubject: Record<string, Json> = {
    schema: "lifecycle.agent-execution-cell-provider-result.v1",
    ...providerFacts,
  };
  const providerResult: Record<string, Json> = {
    ...providerSubject,
    digest: selfDigest(providerSubject),
  };
  const terminal = await writeAgentTerminalObservation(input);
  await mkdir(join(input.outputRoot, "provider-result"), { recursive: false, mode: 0o700 });
  const providerBytes = Buffer.from(`${canonical(providerResult)}\n`, "utf8");
  await writeFile(
    join(input.outputRoot, AGENT_PROVIDER_RESULT_PATH),
    providerBytes,
    { flag: "wx", mode: 0o600 },
  );

  const limits = record(input.specification.limits, "Execution limits");
  const maximumOutputBytes = integer(limits.outputBytes, "Execution output-byte limit");
  const maximumEntryBytes = integer(limits.outputEntryBytes, "Execution output-entry byte limit");
  const manifestEntries: Array<Record<string, Json>> = [
    {
      path: AGENT_PROVIDER_RESULT_PATH,
      entryKind: "file",
      purpose: "raw-provider-output",
      mediaType: "application/json",
      modeClass: "regular",
      byteLength: providerBytes.byteLength,
      digest: sha256(providerBytes),
    },
    {
      path: AGENT_PROVIDER_TERMINAL_OBSERVATION_PATH,
      entryKind: "file",
      purpose: "operational-artifact",
      mediaType: "application/json",
      modeClass: "regular",
      byteLength: terminal.bytes.byteLength,
      digest: sha256(terminal.bytes),
    },
  ];
  if (await pathExists(input.semanticPath)) {
    const semantic = await digestFile(input.semanticPath, maximumEntryBytes, "Agent semantic Work Product");
    manifestEntries.push({
      path: AGENT_SEMANTIC_OUTPUT_PATH,
      entryKind: "file",
      purpose: "agent-work-product",
      mediaType: "text/markdown; charset=utf-8",
      modeClass: "regular",
      byteLength: semantic.byteLength,
      digest: semantic.digest,
    });
  }
  if (operation.role === "builder") {
    if (input.candidateRoot === null) fail("Builder output lacks its complete Candidate successor");
    const candidate = await inventory(input.candidateRoot, maximumOutputBytes);
    for (const entry of candidate.entries) {
      manifestEntries.push({
        path: `candidate-output/${entry.path}`,
        entryKind: "file",
        purpose: "candidate-output",
        mediaType: "application/octet-stream",
        modeClass: entry.mode,
        byteLength: entry.bytes,
        digest: entry.digest,
      });
    }
  }
  await writeAgentManifest({
    outputRoot: input.outputRoot,
    specification: input.specification,
    entries: manifestEntries,
  });
}

async function runAgentCell(input: Readonly<{
  inputRoot: string;
  outputRoot: string;
  specification: FoundationExecutionSpecificationV1;
  workingRoot: string;
}>): Promise<void> {
  const operation = record(input.specification.operation, "Agent operation");
  const role = text(operation.role, "Agent role");
  if (!(["reconnaissance", "builder", "reviewer"] as string[]).includes(role)) {
    fail("Agent operation role is unsupported");
  }
  const limits = record(input.specification.limits, "Execution limits");
  const storageLimit = integer(limits.storageBytes, "Execution storage limit");
  const wallTime = integer(limits.wallTimeMilliseconds, "Execution wall-time limit");
  const networkPolicy = record(input.specification.networkPolicy, "Agent network policy");
  const providerPolicyDigest = exactDigest(
    networkPolicy.providerPolicyDigest,
    "Agent provider-control policy digest",
  );
  const preparedAt = new Date().toISOString();
  const runnerImplementationDigest = exactDigest(
    operation.adapterImplementationDigest,
    "Fixed runner-adapter implementation digest",
  );
  let facts: AgentProviderTerminalFacts = Object.freeze({
    preparedAt,
    startedAt: null,
    finishedAt: preparedAt,
    executableIdentity: null,
    outcome: "runtime-failure",
    stage: "preflight",
    productiveStarted: false,
    firstTrigger: "runtime-failure",
    exitCode: null,
    signal: null,
    sessionId: null,
  });
  let proxyRetired = false;
  try {
    const inputSet = await validateInputSet(input.inputRoot, input.specification);
    const providerInputRoot = await materializeFoundationAgentProviderVisibleInputV1({
      transportInputRoot: input.inputRoot,
      inputSet,
      destinationRoot: PROVIDER_VISIBLE_INPUT_ROOT,
    });
    await exactFileTree({
      root: input.outputRoot,
      expectedFiles: new Set<string>(),
      maximumEntries: 1,
      label: "Execution output root",
    });
    const support = await waitForAgentProviderSupport(input.specification);
    facts = Object.freeze({
      ...facts,
      finishedAt: new Date().toISOString(),
      stage: "compatibility",
    });
    await assertInstalledCodex(support);
    const runnerImplementation = await digestFile(
      RUNNER_EXECUTABLE,
      16 * 1024 * 1024,
      "Installed Execution Cell runner",
    );
    if (runnerImplementation.digest !== runnerImplementationDigest) {
      fail("Installed Execution Cell runner differs from its Specification-bound implementation");
    }
    facts = Object.freeze({
      ...facts,
      executableIdentity: support.executableIdentity,
      finishedAt: new Date().toISOString(),
    });
    await activateAgentProviderHome();
    await mkdir("/tmp/lifecycle-agent-parent-home", { recursive: false, mode: 0o700 });
    await mkdir("/tmp/lifecycle-agent-home", { recursive: false, mode: 0o700 });
    let candidateRoot: string | null = null;
    if (role !== "reconnaissance") {
      candidateRoot = role === "builder"
        ? join(input.outputRoot, "candidate-output")
        : join(input.workingRoot, "candidate");
      await materializeCheckSubject(
        input.inputRoot,
        input.workingRoot,
        storageLimit,
        "final",
        "unused-for-candidate-carrier",
        candidateRoot,
      );
    }
    const semanticRoot = join(input.outputRoot, "agent-work-product");
    const semanticPath = join(input.outputRoot, AGENT_SEMANTIC_OUTPUT_PATH);
    await mkdir(semanticRoot, { recursive: false, mode: 0o700 });
    const semanticTemplate = await readFile(join(input.inputRoot, SEMANTIC_TEMPLATE_PATH));
    if (semanticTemplate.byteLength > storageLimit) {
      fail("Semantic template exceeds the Cell storage bound");
    }
    await writeFile(semanticPath, semanticTemplate, { mode: 0o600 });
    const roleBrief = await exactUtf8Input(
      join(providerInputRoot, ROLE_BRIEF_PATH),
      storageLimit,
      "Agent role brief",
    );
    const cwd = candidateRoot ?? input.workingRoot;
    const permissionOverrides = agentPermissionOverrides({
      transportInputRoot: input.inputRoot,
      providerInputRoot,
      workingRoot: input.workingRoot,
      candidateRoot,
      candidateWritable: role === "builder",
      semanticRoot,
    });
    const environment = Object.freeze({
      CODEX_HOME: PROVIDER_CODEX_HOME,
      HOME: "/tmp/lifecycle-agent-parent-home",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      LIFECYCLE_CREDENTIAL_CANARY: "runner-only-preflight-canary",
      HTTP_PROXY: `http://${PROVIDER_CONTROL_HOST}:${PROVIDER_CONTROL_PORT}`,
      HTTPS_PROXY: `http://${PROVIDER_CONTROL_HOST}:${PROVIDER_CONTROL_PORT}`,
      http_proxy: `http://${PROVIDER_CONTROL_HOST}:${PROVIDER_CONTROL_PORT}`,
      https_proxy: `http://${PROVIDER_CONTROL_HOST}:${PROVIDER_CONTROL_PORT}`,
      PATH: "/opt/lifecycle/codex-path:/opt/lifecycle/bin:/usr/local/bin:/usr/bin:/bin",
      TZ: "UTC",
    });
    facts = Object.freeze({
      ...facts,
      outcome: "security-stop",
      firstTrigger: "security-stop",
      stage: "preflight",
      finishedAt: new Date().toISOString(),
    });
    await assertAgentToolIsolation({
      cwd,
      providerInputRoot,
      transportInputRoot: input.inputRoot,
      semanticRoot,
      environment,
      permissionOverrides,
      timeoutMs: wallTime,
    });
    facts = Object.freeze({
      ...facts,
      outcome: "runtime-failure",
      firstTrigger: "runtime-failure",
      stage: "dispatch",
      finishedAt: new Date().toISOString(),
    });
    const prompt = agentPrompt({
      role,
      roleBrief,
      providerInputRoot,
      candidateRoot,
      semanticPath,
    });
    const result = await run({
      executable: CODEX_EXECUTABLE,
      arguments: foundationAgentCodexExecArgumentsV1({
        cwd,
        model: support.model,
        reasoning: support.reasoning,
        permissionOverrides,
      }),
      cwd,
      environment,
      stdin: Buffer.from(prompt, "utf8"),
      timeoutMs: wallTime,
      maximumStdoutBytes: MAXIMUM_PROVIDER_EVENT_BYTES,
      maximumStderrBytes: MAXIMUM_PROVIDER_EVENT_BYTES,
    });
    facts = agentProviderFacts({
      executableIdentity: support.executableIdentity,
      preparedAt,
      provider: result,
    });
    await rm(PROVIDER_CODEX_HOME, { recursive: true, force: true });
    await retireProviderControlProxy({
      specificationDigest: support.specificationDigest,
      providerPolicyDigest,
    });
    proxyRetired = true;
    await writeAgentOutput({
      outputRoot: input.outputRoot,
      specification: input.specification,
      runnerImplementationDigest,
      facts,
      semanticPath,
      candidateRoot,
    });
  } catch {
    if (!proxyRetired) {
      try {
        await retireProviderControlProxy({
          specificationDigest: exactDigest(
            input.specification.digest,
            "Execution Specification digest",
          ),
          providerPolicyDigest,
        });
        proxyRetired = true;
      } catch {
        // Backend containment remains the authoritative fallback when the
        // fixed proxy cannot acknowledge its own retirement.
      }
    }
    try { await rm(PROVIDER_CODEX_HOME, { recursive: true, force: true }); }
    catch { /* Cell containment removes remaining private support. */ }
    const finishedAt = new Date().toISOString();
    await writeFoundationAgentRunnerTerminalOutputV1({
      outputRoot: input.outputRoot,
      specification: input.specification,
      runnerImplementationDigest,
      facts: Object.freeze({ ...facts, finishedAt }),
    });
  }
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 1 && arguments_[0] === "provider-support-receive") {
    await receiveAgentProviderSupport();
    return;
  }
  if (arguments_.length === 7 && arguments_[0] === "provider-control-proxy" &&
      arguments_[1] === "--specification-digest" && arguments_[3] === "--policy-digest" &&
      arguments_[5] === "--wall-time-milliseconds") {
    const wallTimeMilliseconds = Number(arguments_[6]);
    if (!Number.isSafeInteger(wallTimeMilliseconds) || wallTimeMilliseconds < 1 ||
        wallTimeMilliseconds > 86_400_000) {
      fail("Provider-control wall-time bound is invalid");
    }
    await runProviderControlProxy({
      specificationDigest: exactDigest(arguments_[2], "Provider-control Specification digest"),
      providerPolicyDigest: exactDigest(arguments_[4], "Provider-control policy digest"),
      wallTimeMilliseconds,
    });
    return;
  }
  if (arguments_.length !== 7 || arguments_[0] !== "execute" || arguments_[1] !== "--specification" ||
      arguments_[3] !== "--input" || arguments_[5] !== "--output") fail("arguments are invalid");
  const specificationPath = resolve(arguments_[2]!);
  const inputRoot = resolve(arguments_[4]!);
  const outputRoot = resolve(arguments_[6]!);
  if (!within(inputRoot, specificationPath)) fail("Specification is outside the fixed input root");
  const specification = await boundedJson(specificationPath, "Execution Specification");
  validateSpecification(specification);
  const operation = record(specification.operation, "Execution operation");
  const limits = record(specification.limits, "Execution Specification limits");
  const storageLimit = integer(limits.storageBytes, "Execution storage limit");
  const agent = operation.kind === "agent-attempt";
  if (!agent) {
    await validateInputSet(inputRoot, specification);
    await exactFileTree({
      root: outputRoot,
      expectedFiles: new Set<string>(),
      maximumEntries: 1,
      label: "Execution output root",
    });
  }
  const workingRoot = await mkdtemp(join(
    tmpdir(),
    agent ? "lifecycle-agent-cell-" : "lifecycle-check-cell-",
  ));
  try {
    if (agent) {
      await runAgentCell({
        inputRoot,
        outputRoot,
        specification: specification as unknown as FoundationExecutionSpecificationV1,
        workingRoot,
      });
      return;
    }
    const phase = operation.phase;
    if (!(phase === "baseline" || phase === "final")) fail("Check operation phase is invalid");
    const owner = record(specification.owner, "Execution Specification owner");
    const subjectRoot = await materializeCheckSubject(
      inputRoot,
      workingRoot,
      storageLimit,
      phase,
      text(owner.ownerSubjectDigest, "Check proof-subject digest"),
    );
    const before = await inventory(subjectRoot, storageLimit);
    const binding = await boundedJson(join(inputRoot, CHECK_BINDING_PATH), "Check Binding");
    if (binding.digest !== operation.bindingDigest || binding.kind !== "command" || binding.mutation !== "forbidden") {
      fail("Check Binding differs from the Execution Specification");
    }
    if (integer(binding.timeoutMs, "Check timeout") >
        integer(limits.wallTimeMilliseconds, "Execution wall-time limit")) {
      fail("Check Binding timeout exceeds the Execution Specification wall time");
    }
    const executable = record(binding.executable, "Check executable");
    const executablePath = safeRelativePath(text(executable.path, "Check executable path"), "Check executable path");
    const command = executable.relativeTo === "candidate"
      ? resolve(subjectRoot, executablePath)
      : executablePath;
    if (executable.relativeTo === "candidate" && !within(subjectRoot, command)) fail("Check executable escaped its proof subject");
    if (executable.relativeTo !== "candidate" && executable.relativeTo !== "execution-image") {
      fail("Check executable has an unsupported base");
    }
    const cwdValue = text(binding.cwd, "Check cwd");
    const cwd = cwdValue === "."
      ? subjectRoot
      : resolve(subjectRoot, safeRelativePath(cwdValue, "Check cwd"));
    if (!within(subjectRoot, cwd)) fail("Check cwd escaped its proof subject");
    const args = binding.args;
    if (!Array.isArray(args) || args.some((value) => typeof value !== "string" || value.includes("\0"))) {
      fail("Check arguments are invalid");
    }
    const result = await run({
      executable: command,
      arguments: args as string[],
      cwd,
      environment: bindingEnvironment(binding),
      timeoutMs: integer(binding.timeoutMs, "Check timeout"),
      maximumStdoutBytes: MAXIMUM_STREAM_BYTES,
      maximumStderrBytes: MAXIMUM_STREAM_BYTES,
    });
    const after = await inventory(subjectRoot, storageLimit);
    const parser = record(binding.resultParser, "Check result parser");
    exactKeys(parser, ["id", "stateModel", "states"], "Check result parser");
    if (parser.id !== "exit-code-v1") fail("First Check Cell supports only exit-code-v1");
    const parserDisposition = result.signal !== null || result.timedOut ||
        result.stdoutTruncated || result.stderrTruncated || result.exitCode === null
      ? "failed"
      : "passed";
    const proof: Record<string, Json> = {
      schema: "lifecycle.check-cell-proof.v1",
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      parserId: parser.id,
      parserDisposition,
      subjectBeforeDigest: before.digest,
      subjectAfterDigest: after.digest,
      subjectIntegrity: before.digest === after.digest ? "unchanged" : "changed",
      resultFacts: [{ name: "exit-code", value: result.exitCode }] as unknown as Json,
      digest: "",
    };
    proof.digest = selfDigest(proof);
    await writeOutput({
      outputRoot,
      specification,
      proof,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } finally {
    await rm(workingRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof ExecutionCellRunnerFailure
      ? error.message
      : "unexpected fixed-runner failure";
    process.stderr.write(`execution-cell-runner: ${message}\n`);
    process.exitCode = 70;
  }
}
