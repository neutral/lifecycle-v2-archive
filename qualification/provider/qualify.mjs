#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeQualificationAtlas } from "../support/atlas-fixture.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const WORKSPACE = resolve(dirname(SCRIPT), "..", "..");
const CLI = join(WORKSPACE, "runtime", "bin", "lifecycle.mjs");
const MAXIMUM_CAPTURE_BYTES = 16 * 1024 * 1024;
const EXPECTED_DESCRIPTOR_DIGEST =
  "sha256:4bcb41216dad08468d53d7208909d3417415c6f5b7b1078da72285650a92d021";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

const ENVIRONMENT = Object.freeze({
  machineHome: "LIFECYCLE_MACHINE_HOME",
  model: "LIFECYCLE_FOUNDATION_PROVIDER_MODEL",
  reasoning: "LIFECYCLE_FOUNDATION_PROVIDER_REASONING",
  dockerPath: "LIFECYCLE_DOCKER_PATH",
  dockerHost: "LIFECYCLE_DOCKER_HOST",
  dockerConfig: "LIFECYCLE_DOCKER_CONFIG",
  imageId: "LIFECYCLE_EXECUTION_IMAGE_ID",
  imageDigest: "LIFECYCLE_EXECUTION_IMAGE_DIGEST",
  imageArchitecture: "LIFECYCLE_EXECUTION_IMAGE_ARCHITECTURE",
  runnerContractDigest: "LIFECYCLE_EXECUTION_RUNNER_CONTRACT_DIGEST",
  runnerImplementationDigest: "LIFECYCLE_EXECUTION_RUNNER_IMPLEMENTATION_DIGEST",
  toolInventoryDigest: "LIFECYCLE_EXECUTION_TOOL_INVENTORY_DIGEST",
  codexVersion: "LIFECYCLE_EXECUTION_CODEX_VERSION",
  codexExecutableIdentity: "LIFECYCLE_EXECUTION_CODEX_EXECUTABLE_IDENTITY",
  agentAdapterImplementationDigest:
    "LIFECYCLE_EXECUTION_AGENT_ADAPTER_IMPLEMENTATION_DIGEST",
});

const EXECUTION_ENVIRONMENT_NAMES = Object.freeze(Object.values(ENVIRONMENT));
const CONTROLLER_ENVIRONMENT_NAMES = Object.freeze([
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "TZ",
]);
const GIT_CONFIGURATION_ARGUMENTS = Object.freeze([
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "core.attributesFile=/dev/null",
  "-c", "core.pager=",
]);
const CLOSED_GIT_ENVIRONMENT = Object.freeze({
  PATH: "/usr/bin:/bin",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_LFS_SKIP_SMUDGE: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
});
const EXECUTION_POLICY_KEYS = Object.freeze([
  "cancellationPolicyDigest",
  "containmentPolicyDigest",
  "parentLossPolicyDigest",
  "recoveryPolicyDigest",
  "retirementPolicyDigest",
]);
const REQUIRED_EVENT_ORDER = Object.freeze([
  "delivery-created",
  "director-brief-submitted",
  "activity-started",
  "agent-attempt-prepared",
  "provider-effect-intended",
  "provider-effect-observed",
  "agent-work-product-submitted",
  "execution-receipt-recorded",
  "work-boundary-finalized",
  "check-receipt-recorded",
  "activity-completed",
]);

const PENDING_QUALIFICATION_DOCUMENT = [
  "# Docker Agent qualification target",
  "",
  "Status: pending",
  "",
].join("\n");

const COMPLETE_QUALIFICATION_DOCUMENT = [
  "# Docker Agent qualification target",
  "",
  "Status: complete",
  "",
].join("\n");

const EXPECTED_TERMINAL_EVENT_KINDS = Object.freeze([
  "delivery-created",
  "director-brief-submitted",
  "activity-started",
  "agent-attempt-prepared",
  "provider-effect-intended",
  "provider-effect-observed",
  "agent-work-product-submitted",
  "execution-receipt-recorded",
  "work-boundary-finalized",
  "check-receipt-recorded",
  "activity-completed",
  "activity-started",
  "director-decision-authenticated",
  "transaction-effect-intended",
  "transaction-effect-observed",
  "candidate-revision-observed",
  "activity-completed",
  "director-brief-submitted",
  "activity-started",
  "agent-attempt-prepared",
  "provider-effect-intended",
  "provider-effect-observed",
  "agent-work-product-submitted",
  "candidate-revision-observed",
  "execution-receipt-recorded",
  "activity-completed",
  "activity-started",
  "integration-assessed",
  "candidate-revision-observed",
  "material-condition-frozen",
  "activity-completed",
  "director-brief-submitted",
  "activity-started",
  "agent-attempt-prepared",
  "provider-effect-intended",
  "provider-effect-observed",
  "agent-work-product-submitted",
  "execution-receipt-recorded",
  "work-boundary-finalized",
  "check-receipt-recorded",
  "activity-completed",
  "activity-started",
  "director-decision-authenticated",
  "transaction-effect-intended",
  "transaction-effect-observed",
  "candidate-revision-observed",
  "activity-completed",
  "activity-started",
  "integration-assessed",
  "candidate-revision-observed",
  "activity-completed",
  "director-brief-submitted",
  "activity-started",
  "candidate-sealed",
  "check-receipt-recorded",
  "agent-attempt-prepared",
  "provider-effect-intended",
  "provider-effect-observed",
  "agent-work-product-submitted",
  "execution-receipt-recorded",
  "evidence-packet-finalized",
  "activity-completed",
  "activity-started",
  "director-decision-authenticated",
  "transaction-effect-intended",
  "transaction-effect-observed",
  "closure-recorded",
]);

const DIRECTOR_BRIEF = [
  "# Docker Agent Cell Qualification Direction",
  "",
  "Prepare one bounded Work Boundary that changes only `docs/qualification.md` from the exact pending state to the exact complete state.",
  "",
  "Complete the supplied Reconnaissance Work Product template in the governed semantic workspace.",
  "Select Knowledge `description.docker-agent-qualification` and `check.live-provider-qualification`; do not select an external source.",
  "Create one required behavior obligation sourced from `description.docker-agent-qualification` and the fixed mandate.",
  "Select artifact `docs/qualification.md` with role `documentation`, `Must change: true`, and that obligation.",
  "Select binding `live-provider-qualification-check` as one regression-guard Check required at both baseline and final phases.",
  "Create one acceptance proposition requiring the exact pending-to-complete diff and the final Check pass, backed by that artifact, obligation, and Check.",
  "The baseline Check remains a separate runtime admission and Evidence Packet requirement; do not make its Receipt evidence for the reviewer proposition.",
  "Do not select or change any other artifact, and do not invent private paths.",
  "",
].join("\n");

const BUILDER_DIRECTION = [
  "# Docker Agent Cell Qualification Builder Direction",
  "",
  "Implement the admitted Work Boundary exactly.",
  "Change only `docs/qualification.md`, replacing the single word `pending` with `complete` and preserving every other byte.",
  "Do not modify the Check executable, Atlas, Knowledge, repository metadata, or any other path.",
  "Complete the supplied Builder Work Product with `Disposition: complete`, `Uncertainty: none`, and `Kind: ready-to-evaluate`.",
  "For this bounded fixture, keep the Work Product to its Outcome and Proposal sections; omit Claims, Citations, Limitations, Material Condition, Effect, and Remaining Obligation fields.",
  "A builder-local Check is feedback only; do not claim or cite a Runtime Check Receipt.",
  "",
].join("\n");

const REVIEWER_DIRECTION = [
  "# Docker Agent Cell Qualification Reviewer Direction",
  "",
  "Independently evaluate the sealed Candidate against every exact frozen proposition and required evidence.",
  "Confirm that only `docs/qualification.md` changed from `Status: pending` to `Status: complete`, that the final Check passed, and that no mandate excess or missing obligation exists.",
  "Complete the supplied Reviewer Work Product with `Disposition: complete`, `Uncertainty: none`, one accepted decision for every and only frozen proposition, exact Attempt-local citations, and no Material Condition.",
  "Keep reviewer Claims free of Knowledge and Evidence declarations. Cite `candidate.diff` and the final Check Receipt for the accepted proposition decision. State that the reaffirmed mandate remains applicable to the exact integrated result and that every baseline required by the active Work Boundary remains sufficient; cite its exact baseline Check Receipt in that baseline applicability judgment. An earlier Boundary's historical baseline does not substitute for the new required baseline.",
  "",
].join("\n");

const ATLAS_MAINTENANCE = "\nThe exact pending-to-complete qualification transition remains the project choice; independently maintained context must survive Delivery publication.\n";

function resolutionDirection(boundary, candidate, workProduct) {
  return [
    "# Reaffirm the exact qualification mandate",
    "",
    "The Director separately clarified the Atlas root. Preserve the complete admitted mandate; this context change adds no Product requirement or capability.",
    "Read the frozen Candidate working tree, including docs/qualification.md. Do not write any Candidate path or export Product output; only complete the supplied reconnaissance semantic Work Product.",
    `Verify its Git tree is ${candidate.payload.state.tree} and docs/qualification.md has SHA-256 ${sha256(COMPLETE_QUALIFICATION_DOCUMENT)}. The document must already be complete.`,
    "Propose a complete reaffirmation using the exact original Objective, Direction, Effects, Risks, Obligation, Artifact, Check and Proposition text and relationships below. Keep all selected Knowledge, Discipline, external-source, Capability and Projection selections unchanged. Do not paraphrase mandate fields or create new ids.",
    "Use the current Attempt-local citation handles from this Role Brief, not handles copied from the original Work Product. Let Runtime supply the newly selected P Snapshot and new required baseline Receipt.",
    "",
    "## Exact admitted mandate and selections",
    "```json",
    JSON.stringify({ mandate: boundary.payload.mandate, knowledge: boundary.payload.knowledge,
      disciplines: boundary.payload.disciplines, externalSources: boundary.payload.externalSources,
      capabilityProfile: boundary.payload.capabilityProfile, projectionProfile: boundary.payload.projectionProfile }, null, 2),
    "```",
    "",
    "## Original submitted reconnaissance form (replace its local citation handles)",
    workProduct.semanticMarkdown,
    "",
  ].join("\n");
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function digestCanonical(value) {
  return sha256(canonicalJson(value));
}

function bounded(value) {
  const bytes = Buffer.from(String(value), "utf8");
  return `[capture bytes=${bytes.byteLength} digest=${sha256(bytes)}]`;
}

function requiredEnvironment(name, maximumBytes = 4_096) {
  const value = process.env[name];
  if (
    typeof value !== "string" || value.length === 0 || value.includes("\0") ||
    /[\r\n]/u.test(value) || Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new Error(`Docker Agent qualification requires exact ${name}`);
  }
  return value;
}

function selectedEnvironment() {
  const selected = Object.freeze(Object.fromEntries(Object.entries(ENVIRONMENT).map(([key, name]) => [
    key,
    requiredEnvironment(name, key === "model" || key === "reasoning" ? 256 : 4_096),
  ])));
  for (const key of [
    "imageDigest",
    "runnerContractDigest",
    "runnerImplementationDigest",
    "toolInventoryDigest",
    "codexExecutableIdentity",
    "agentAdapterImplementationDigest",
  ]) {
    if (!SHA256.test(selected[key])) {
      throw new Error(`Docker Agent qualification requires one exact digest for ${ENVIRONMENT[key]}`);
    }
  }
  if (selected.codexVersion !== "0.153.4") {
    throw new Error("Docker Agent qualification requires the exact selected Codex 0.153.4 image tool");
  }
  if (selected.agentAdapterImplementationDigest !== selected.runnerImplementationDigest) {
    throw new Error("Docker Agent qualification requires the fixed runner to own the exact Agent adapter");
  }
  if (selected.imageArchitecture !== "amd64" && selected.imageArchitecture !== "arm64") {
    throw new Error("Docker Agent qualification requires amd64 or arm64 image architecture");
  }
  if (!/^unix:\/\/\/[^\0\r\n]+$/u.test(selected.dockerHost)) {
    throw new Error("Docker Agent qualification requires one explicit local Unix Docker endpoint");
  }
  return selected;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let captureExceeded = false;
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= MAXIMUM_CAPTURE_BYTES) stdout.push(Buffer.from(chunk));
      else {
        captureExceeded = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= MAXIMUM_CAPTURE_BYTES) stderr.push(Buffer.from(chunk));
      else {
        captureExceeded = true;
        child.kill("SIGKILL");
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 120_000);
    timer.unref();
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolveRun(Object.freeze({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        captureExceeded,
        timedOut,
      }));
    });
  });
}

function succeeded(result, label) {
  assert.equal(result.timedOut, false, `${label} timed out`);
  assert.equal(result.captureExceeded, false, `${label} exceeded its output bound`);
  assert.equal(result.signal, null, `${label} exited by ${result.signal}: ${bounded(result.stderr)}`);
  assert.equal(result.code, 0, `${label} failed: ${bounded(result.stderr)}`);
  return result;
}

async function physicalDirectory(input, label) {
  if (!isAbsolute(input) || resolve(input) !== input) {
    throw new Error(`${label} must be one normalized absolute path`);
  }
  const [state, physical] = await Promise.all([lstat(input), realpath(input)]);
  if (!state.isDirectory() || state.isSymbolicLink() || physical !== input) {
    throw new Error(`${label} must be one canonical physical directory`);
  }
  return physical;
}

async function physicalExecutable(input, label) {
  if (!isAbsolute(input) || resolve(input) !== input) {
    throw new Error(`${label} must be one normalized absolute path`);
  }
  const [state, physical] = await Promise.all([lstat(input), realpath(input)]);
  await access(input, fsConstants.X_OK);
  if (!state.isFile() || state.isSymbolicLink() || physical !== input) {
    throw new Error(`${label} must be one canonical executable regular file`);
  }
  return physical;
}

async function assertPrivateAuthentication(codexHome) {
  const path = join(codexHome, "auth.json");
  const state = await lstat(path);
  await access(path, fsConstants.R_OK);
  if (
    !state.isFile() || state.isSymbolicLink() || state.size < 2 ||
    state.size > 1024 * 1024 || (state.mode & 0o077) !== 0
  ) {
    throw new Error("Docker Agent qualification requires one bounded private fixed-runner auth file");
  }
}

export async function exactSourceRevision(options = {}) {
  const execute = options.execute ?? run;
  const workspace = options.workspace ?? WORKSPACE;
  const revision = succeeded(await execute("/usr/bin/git", [
    ...GIT_CONFIGURATION_ARGUMENTS,
    "-C", workspace,
    "rev-parse", "HEAD",
  ], {
    env: CLOSED_GIT_ENVIRONMENT,
  }), "source revision").stdout.trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision)) {
    throw new Error("Docker Agent qualification requires one exact committed source revision");
  }
  const status = succeeded(await execute("/usr/bin/git", [
    ...GIT_CONFIGURATION_ARGUMENTS,
    "-C", workspace,
    "status", "--porcelain=v1", "--untracked-files=all",
  ], { env: CLOSED_GIT_ENVIRONMENT }), "source status");
  if (status.stdout !== "") {
    throw new Error("Docker Agent qualification requires a tracked-clean source revision");
  }
  return revision;
}

async function git(repository, args) {
  return succeeded(await run("/usr/bin/git", [
    ...GIT_CONFIGURATION_ARGUMENTS,
    "-C", repository,
    ...args,
  ], {
    env: CLOSED_GIT_ENVIRONMENT,
  }), `git ${args[0] ?? ""}`);
}

export function runtimeEnvironment(selection, ambient = process.env) {
  const environment = {};
  for (const name of CONTROLLER_ENVIRONMENT_NAMES) {
    if (typeof ambient[name] === "string") environment[name] = ambient[name];
  }
  for (const [key, name] of Object.entries(ENVIRONMENT)) environment[name] = selection[key];
  environment.NO_COLOR = "1";
  assert.deepEqual(
    Object.keys(environment).sort(),
    ["NO_COLOR", ...CONTROLLER_ENVIRONMENT_NAMES.filter((name) =>
      typeof ambient[name] === "string"),
      ...EXECUTION_ENVIRONMENT_NAMES].sort(),
  );
  return Object.freeze(environment);
}

function scopedLifecycleEnvironment(environment, retainedNames) {
  const selected = { ...environment };
  const retained = new Set(retainedNames);
  for (const name of Object.keys(selected)) {
    if (name.startsWith("LIFECYCLE_") && !retained.has(name)) delete selected[name];
  }
  assert.deepEqual(
    Object.keys(selected).filter((name) => name.startsWith("LIFECYCLE_")).sort(),
    [...retained].sort(),
  );
  return selected;
}

function assertNoPrivateOutput(value, privateValues, label) {
  const source = typeof value === "string" ? value : JSON.stringify(value);
  for (const privateValue of privateValues) {
    assert.equal(source.includes(privateValue), false, `${label} exposed private custody`);
  }
}

function safeCliFailure(completed, label, privateValues) {
  assert.equal(completed.timedOut, false, `${label} timed out`);
  assert.equal(completed.captureExceeded, false, `${label} exceeded its output bound`);
  assert.equal(completed.signal, null, `${label} exited by ${completed.signal}`);
  assert.equal(completed.stdout, "", `${label} wrote a result while failing`);
  assertNoPrivateOutput(completed.stderr, privateValues, label);
  let envelope;
  try {
    envelope = JSON.parse(completed.stderr);
  } catch {
    throw new Error(`${label} failed with a non-protocol diagnostic: ${bounded(completed.stderr)}`);
  }
  assert(
    envelope !== null && typeof envelope === "object" && !Array.isArray(envelope),
    `${label} returned a non-object failure envelope`,
  );
  assert.deepEqual(Object.keys(envelope).sort(), ["error"]);
  const failure = envelope.error;
  assert(
    failure !== null && typeof failure === "object" && !Array.isArray(failure),
    `${label} returned a non-object public error`,
  );
  const keys = Object.keys(failure).sort();
  const expected = [
    "code",
    "message",
    "operationalStateChanged",
    "recoveryActions",
    "repositoryChanged",
    "retryable",
  ];
  if (Object.hasOwn(failure, "observedFacts")) expected.push("observedFacts");
  assert.deepEqual(keys, expected.sort());
  assert.match(failure.code, /^[a-z0-9][a-z0-9.-]{0,255}$/u);
  assert(
    typeof failure.message === "string" && failure.message.length > 0 &&
      Buffer.byteLength(failure.message, "utf8") <= 4_096 &&
      !/[\0\r\n]/u.test(failure.message),
    `${label} returned an invalid public error message`,
  );
  for (const key of ["retryable", "repositoryChanged", "operationalStateChanged"]) {
    assert.equal(typeof failure[key], "boolean", `${label} returned an invalid ${key}`);
  }
  assert(Array.isArray(failure.recoveryActions), `${label} returned invalid recovery actions`);
  for (const action of failure.recoveryActions) {
    assert(
      action !== null && typeof action === "object" && !Array.isArray(action),
      `${label} returned an invalid recovery action`,
    );
    assert.deepEqual(Object.keys(action).sort(), ["action", "detail"]);
    assert.equal(typeof action.action, "string");
    assert.equal(typeof action.detail, "string");
  }
  return Object.freeze({ code: failure.code, message: failure.message });
}

async function runCli(args, options) {
  const label = `lifecycle ${args[0] ?? ""}`;
  const completed = await run(process.execPath, [CLI, ...args], {
    cwd: options.cwd,
    env: options.environment,
    timeoutMs: options.timeoutMs,
  });
  if (completed.code !== 0 || completed.signal !== null || completed.timedOut ||
      completed.captureExceeded) {
    const failure = safeCliFailure(completed, label, options.privateValues ?? []);
    throw new Error(`${label} failed with ${failure.code}: ${failure.message}`);
  }
  assert.equal(completed.stderr, "", `${label} wrote diagnostics`);
  assertNoPrivateOutput(
    completed.stdout,
    options.privateValues ?? [],
    label,
  );
  const result = JSON.parse(completed.stdout);
  if (args[0] !== "version") {
    assert.equal(result.schema, "lifecycle.foundation-runtime-result.v17");
    assert.equal(result.runtimeProtocol, "lifecycle.runtime.foundation.v17");
    assert.equal(result.interfaceProtocol, "lifecycle.interface.foundation.v17");
    assert.match(result.digest, SHA256);
  }
  return Object.freeze({ result, stdout: completed.stdout });
}

function liveCheckKnowledge() {
  const header = {
    schema: "lifecycle.knowledge-record.v2",
    kind: "check",
    id: "check.live-provider-qualification",
    title: "Docker Agent Cell qualification Check",
    status: "current",
    revision: 1,
    supersedes: null,
    summary: "Prove that the bounded qualification document remains in one exact admitted state.",
    owners: ["director"],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: [],
    spec: {
      proposition: "The qualification document is exactly one of the two admitted transition states.",
      subjects: [{ kind: "repository", selector: "." }],
      evidenceKinds: ["command"],
      requiredBindings: ["live-provider-qualification-check"],
      evaluation: {
        pass: "The qualification document is one exact admitted state.",
        fail: "The qualification document differs from both exact admitted states.",
        indeterminate: "The qualification document cannot be observed exactly.",
        notRun: "The exact-state Check was not run.",
      },
      limits: ["This Check observes only exact bytes of docs/qualification.md."],
      freshness: {
        subjectBinding: "exact",
        maximumAgeMs: null,
        environmentBinding: "exact",
      },
      falsifiers: ["The document is neither the exact pending state nor the exact complete state."],
    },
  };
  const sections = ["Proposition", "Evaluation", "Evidence", "Limits"]
    .map((section) => `## ${section}\n\n${section} details.`)
    .join("\n\n");
  return `---\n${JSON.stringify(header, null, 2)}\n---\n\n# Docker Agent Cell qualification Check\n\n${sections}\n`;
}

function liveDescriptionKnowledge() {
  const header = {
    schema: "lifecycle.knowledge-record.v2",
    kind: "description",
    id: "description.docker-agent-qualification",
    title: "Docker Agent qualification artifact",
    status: "current",
    revision: 1,
    supersedes: null,
    summary: "Own the exact pending-to-complete transition used by the Docker Agent qualification Delivery.",
    owners: ["director"],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: [],
    spec: {
      responsibility: "Own the exact Docker Agent qualification state transition.",
      coverage: [
        { path: "checks/verify-qualification-state.sh", mode: "file", role: "primary", exclude: [] },
        { path: "docs/qualification.md", mode: "file", role: "primary", exclude: [] },
      ],
      behavior: [
        "changes the tracked qualification document from exact pending state to exact complete state",
        "checks that the tracked qualification document is one exact admitted state",
      ],
      boundaries: ["contains no authority, provider credential, or Runtime custody"],
      invariants: ["changes no path other than docs/qualification.md", "remains ordinary tracked product content"],
      dependencies: [],
      failure: [
        "the qualification artifact cannot be reproduced from the selected Candidate",
        "the exact-state Check cannot establish the selected document state",
      ],
      rationale: ["one Description makes governed implementation coverage explicit"],
    },
  };
  return `---\n${JSON.stringify(header, null, 2)}\n---\n\n# Docker Agent qualification artifact\n\n## Responsibility\n\nOwn the bounded qualification state transition.\n\n## Behavior\n\nChange only the exact tracked qualification document from pending to complete.\n\n## Boundaries\n\nExclude authority and Runtime custody.\n\n## Rationale\n\nKeep coverage explicit.\n`;
}

function liveCheckExecutable() {
  const pending = sha256(PENDING_QUALIFICATION_DOCUMENT).slice("sha256:".length);
  const complete = sha256(COMPLETE_QUALIFICATION_DOCUMENT).slice("sha256:".length);
  return [
    "#!/bin/sh",
    "set -eu",
    "test -f docs/qualification.md",
    "actual=$(/usr/bin/sha256sum docs/qualification.md | /usr/bin/cut -d ' ' -f 1)",
    `test \"$actual\" = \"${pending}\" || test \"$actual\" = \"${complete}\"`,
    "",
  ].join("\n");
}

function liveCheckBinding() {
  const executable = { relativeTo: "candidate", path: "checks/verify-qualification-state.sh" };
  const base = {
    id: "live-provider-qualification-check",
    checkIds: ["check.live-provider-qualification"],
    subjectSelectors: [{ kind: "repository", selector: "." }],
    kind: "command",
    executable,
    args: [],
    cwd: ".",
    network: "none",
    timeoutMs: 600_000,
    allowedModalities: ["regression-guard"],
    capabilityProfileId: null,
    environment: {},
    resultParser: {
      id: "exit-code-v1",
      stateModel: "check-disposition-v2",
      states: ["pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error"],
    },
    mutation: "forbidden",
    implementationDigest: digestCanonical({ executable, args: [] }),
    limitations: [],
  };
  return Object.freeze({ ...base, digest: digestCanonical(base) });
}

async function writeQuery(root, name, value) {
  const path = join(root, name);
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

function exactRecord(records, kind) {
  const selected = records.filter((record) => record.recordKind === kind);
  assert.equal(selected.length, 1, `Docker Agent row must retain one exact ${kind}`);
  return selected[0];
}

function assertDigest(value, label) {
  assert.match(value, SHA256, `${label} is not one exact digest`);
}

function assertOrderedEvents(events) {
  const kinds = events.map(({ eventKind }) => eventKind);
  let cursor = -1;
  for (const kind of REQUIRED_EVENT_ORDER) {
    const selected = kinds.indexOf(kind, cursor + 1);
    assert.notEqual(selected, -1, `Docker Agent row omitted ${kind}`);
    cursor = selected;
  }
  assert.equal(
    kinds.indexOf("provider-effect-intended"),
    kinds.indexOf("agent-attempt-prepared") + 1,
    "Attempt retention and dispatch intent must be adjacent in the durable Journal",
  );
  for (const kind of [
    "agent-attempt-prepared",
    "provider-effect-intended",
    "provider-effect-observed",
    "execution-receipt-recorded",
  ]) {
    assert.equal(kinds.filter((value) => value === kind).length, 1, `Docker Agent row repeated ${kind}`);
  }
}

async function runRecoverableMutation(input) {
  const runs = [await runCli(input.args, input.options)];
  let current = runs[0].result;
  for (let count = 0; current.status === "recovery-required" && count < 16; count += 1) {
    const recovered = await runCli([
      "recover", input.target, input.deliveryId,
    ], input.options);
    assert.equal(recovered.result.operation, "delivery.recover");
    assert.equal(recovered.result.deliveryId, input.deliveryId);
    runs.push(recovered);
    current = recovered.result;
  }
  assert.equal(current.status, "completed", JSON.stringify(current.diagnostics));
  assert.equal(current.deliveryId, input.deliveryId);
  return Object.freeze({ runs: Object.freeze(runs), result: current });
}

async function inspectDossier(input) {
  const query = await writeQuery(input.privateRoot, `inspect-${input.dossier}-${input.suffix}.json`, {
    kind: "dossier",
    dossier: input.dossier,
    afterRecordId: null,
    limit: 200,
  });
  return await runCli([
    "inspect", input.target, input.deliveryId, "--input", query,
  ], input.options);
}

async function inspectDeliveryView(input) {
  const query = await writeQuery(input.privateRoot, `inspect-delivery-view-${input.suffix}.json`, {
    kind: "delivery-view",
  });
  const run = await runCli([
    "inspect", input.target, input.deliveryId, "--input", query,
  ], input.options);
  assert.equal(run.result.value.kind, "delivery-view");
  assert.equal(run.result.value.view.state.processId, input.deliveryId);
  assertDigest(run.result.value.view.generation.digest, "Delivery View generation");
  return run;
}

async function inspectExactRecord(input, reference) {
  const query = await writeQuery(input.privateRoot, `inspect-record-${reference.id}-${reference.revision}.json`, {
    kind: "record", reference,
  });
  const run = await runCli(["inspect", input.target, input.deliveryId, "--input", query], input.options);
  const record = run.result.value.record;
  assert.equal(record.recordId, reference.id);
  assert.equal(record.revision, reference.revision);
  assert.equal(record.digest, reference.digest);
  return { record, run };
}

function assertRelated(record, relation, reference) {
  assert.deepEqual(record.relationships.filter((edge) => edge.relation === relation).map(({ target }) => target), [reference]);
}

function recordsOfKind(records, kind) {
  return records.filter((record) => record.recordKind === kind);
}

async function openQualificationReclamationOwners(environment, owners) {
  if (owners === undefined) {
    const [configurationModule, runtimeModule, ledgerModule] = await Promise.all([
      import(pathToFileURL(join(
        WORKSPACE, "runtime", "dist", "src", "foundation", "installed-configuration-v7.js",
      )).href),
      import(pathToFileURL(join(
        WORKSPACE, "runtime", "dist", "src", "foundation", "execution", "installed-check-runtime-v1.js",
      )).href),
      import(pathToFileURL(join(
        WORKSPACE, "runtime", "dist", "src", "foundation", "execution", "reclamation-ledger-v1.js",
      )).href),
    ]);
    owners = {
      resolveConfiguration: configurationModule.resolveFoundationInstalledRuntimeConfigurationV7,
      openRuntime: runtimeModule.openFoundationInstalledCheckRuntimeV1,
      openLedger: ledgerModule.openFoundationExecutionReclamationLedgerV1,
    };
  }
  const configuration = await owners.resolveConfiguration({ environment });
  const opened = await owners.openRuntime({
    configuration,
    now: () => new Date().toISOString(),
  });
  try {
    // Qualification independently inspects the existing ledger. Effects remain
    // behind the installed Runtime's exact Reclamation operation.
    const ledger = await owners.openLedger({
      machineHome: configuration.machineHome,
      installationId: configuration.installationId,
      create: false,
    });
    return Object.freeze({
      opened,
      ledger,
      close() {
        try { ledger.close(); }
        finally { opened.close(); }
      },
    });
  } catch (error) {
    opened.close();
    throw error;
  }
}

export async function assertCleanReclamationLedger(environment, owners) {
  const selected = await openQualificationReclamationOwners(environment, owners);
  try {
    assert.equal(
      selected.ledger.list().filter(({ standing }) => standing.state !== "reclaimed").length,
      0,
      "Docker Agent qualification requires a clean Reclamation ledger before allocation",
    );
  } finally {
    selected.close();
  }
}

export async function assertExecutionCellsReclaimed(input, owners) {
  const selected = await openQualificationReclamationOwners(input.environment, owners);
  try {
    const foreignOutstanding = selected.ledger.list().filter(({ owner, standing }) =>
      (owner.storeId !== input.storeId || owner.processId !== input.processId) &&
      standing.state !== "reclaimed");
    assert.equal(
      foreignOutstanding.length,
      0,
      "Docker Agent qualification requires no outstanding foreign Reclamation obligation",
    );
    const summary = selected.ledger.summarizeProcess({
      storeId: input.storeId,
      processId: input.processId,
    });
    assert.equal(summary.obligationCount, input.expectedCount);
    assert.equal(summary.pendingCount, 0,
      "Normal installed operations left outstanding Reclamation obligations");
    assert.equal(summary.reclaimedCount, input.expectedCount);
    // The healthy course must establish automatic cleanup itself. Qualification
    // cannot repair a disconnected maintenance hook and then report success.
    return Object.freeze({ invocations: 0, summary });
  } finally {
    selected.close();
  }
}

function controlRegistrySegment(identity) {
  return `sha256-${sha256(identity).slice("sha256:".length)}`;
}

async function main() {
const selection = selectedEnvironment();
const machineHome = await physicalDirectory(selection.machineHome, "Qualification machine home");
const codexHome = await physicalDirectory(
  join(machineHome, "codex-exec-home"),
  "Qualification fixed-runner Codex home",
);
await assertPrivateAuthentication(codexHome);
const dockerPath = await physicalExecutable(selection.dockerPath, "Qualification Docker executable");
const dockerConfig = await physicalDirectory(selection.dockerConfig, "Qualification Docker config");
const sourceRevision = await exactSourceRevision();
const targetId = `docker-agent-rc16-${randomUUID()}`;
const targetRegistrySegment = controlRegistrySegment(targetId);
const registryRoot = join(machineHome, "control-record-stores");
for (const area of ["active", "archive", "staging"]) {
  assert.equal(
    await lstat(join(registryRoot, area, targetRegistrySegment)).then(() => true).catch((error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    }),
    false,
    "Fresh Docker Agent target already has Control Store custody",
  );
}

const owner = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-foundation-rc16-docker-agent-")));
const target = join(owner, "target");
const privateRoot = join(owner, "private");
const authorityFile = join(privateRoot, "authority.secret");
const initializeInput = join(privateRoot, "initialize.json");
const prepareInput = join(privateRoot, "prepare.md");
const continueInput = join(privateRoot, "continue.md");
const reaffirmInput = join(privateRoot, "reaffirm.md");
const evaluateInput = join(privateRoot, "evaluate.md");
const authoritySecret = randomBytes(48).toString("base64url");
const environment = runtimeEnvironment({
  ...selection,
  machineHome,
  dockerPath,
  dockerConfig,
});
const noLifecycleEnvironment = scopedLifecycleEnvironment(environment, []);
const machineEnvironment = scopedLifecycleEnvironment(environment, [ENVIRONMENT.machineHome]);
const privateValues = Object.freeze([
  authoritySecret,
  WORKSPACE,
  owner,
  machineHome,
  codexHome,
  dockerPath,
  selection.dockerHost,
  dockerConfig,
  privateRoot,
  target,
]);
let qualificationCustodyAllocated = false;
let qualificationCleanupVerified = false;

try {
  await assertCleanReclamationLedger(environment);
  const versionRun = await runCli(["version"], {
    cwd: owner,
    environment: noLifecycleEnvironment,
    timeoutMs: 30_000,
    privateValues,
  });
  const version = versionRun.result;
  assert.equal(version.runtimeVersion, "1.0.0");
  assert.equal(version.runtimeProtocol, "lifecycle.runtime.foundation.v17");
  assert.equal(version.specificationRevision, "lifecycle.foundation.1.0.0-rc.17");
  assert.equal(version.specificationStatus, "draft");
  assert.equal(version.authenticatedPublicationStatus, null);
  assert.equal(version.provider.defaultDescriptorId, "codex-exec-standard-v7");
  assert.equal(version.provider.defaultDescriptorDigest, EXPECTED_DESCRIPTOR_DIGEST);
  assert.equal(version.provider.protocol, "lifecycle.provider-adapter.v7");
  assert.equal(version.codex.executableRange, ">=0.153.4 <0.154.0");
  assert.equal(version.codex.generatedWith, "0.153.4");
  assert.equal(selection.codexVersion, version.codex.generatedWith);

  await Promise.all([mkdir(target), mkdir(privateRoot, { mode: 0o700 })]);
  await git(target, ["init", "-b", "main"]);
  await git(target, ["config", "user.name", "Lifecycle Docker Agent Qualification"]);
  await git(target, ["config", "user.email", "lifecycle-docker-agent@example.invalid"]);
  await writeQualificationAtlas(target);
  await Promise.all([mkdir(join(target, "docs")), mkdir(join(target, "checks"))]);
  await writeFile(
    join(target, "docs", "qualification.md"),
    PENDING_QUALIFICATION_DOCUMENT,
    "utf8",
  );
  await writeFile(
    join(target, "docs", "_qualification.desc.md"),
    liveDescriptionKnowledge(),
    "utf8",
  );
  await writeFile(
    join(target, "checks", "verify-qualification-state.sh"),
    liveCheckExecutable(),
    { encoding: "utf8", mode: 0o755 },
  );
  await writeFile(join(target, ".gitignore"), "node_modules/\n", "utf8");
  await git(target, ["add", "--", "."]);
  await git(target, ["commit", "-m", "Create fresh Docker Agent qualification target"]);

  await writeFile(authorityFile, authoritySecret, { encoding: "utf8", mode: 0o600 });
  await writeFile(initializeInput, JSON.stringify({
    targetId,
    directorPrincipal: "director",
    implementationRoots: ["checks", "docs"],
    checkBindings: {
      "live-provider-qualification-check": liveCheckBinding(),
    },
    stage: true,
  }, null, 2), "utf8");
  const initializeRun = await runCli([
    "initialize", target,
    "--input", initializeInput,
    "--authority-secret-file", authorityFile,
  ], {
    cwd: owner,
    environment: machineEnvironment,
    timeoutMs: 180_000,
    privateValues,
  });
  const initialized = initializeRun.result;
  assert.equal(initialized.operation, "repository.initialize");
  assert.equal(initialized.status, "completed");
  assert.equal(initialized.targetId, targetId);
  assert.equal(initialized.deliveryId, null);
  await writeFile(
    join(target, "records", "checks", "live-provider-qualification.md"),
    liveCheckKnowledge(),
    "utf8",
  );
  await git(target, ["add", "--", "."]);
  await git(target, ["commit", "-m", "Initialize Lifecycle Foundation rc.17"]);

  const contract = JSON.parse(await readFile(join(target, ".lifecycle", "repository.json"), "utf8"));
  assert.equal(contract.$schema, "lifecycle.repository.v22");
  assert.equal(contract.schemaVersion, 21);
  assert.equal(contract.specification.revision, "lifecycle.foundation.1.0.0-rc.17");
  assert.equal(contract.specification.publicationDigest, version.publicationDigest);
  assert.equal(contract.runtime.compatible, "lifecycle.runtime.foundation.v17");
  assert.equal(contract.runtime.interface, "lifecycle.interface.foundation.v17");
  assert.equal(contract.provider.protocol, "lifecycle.provider-adapter.v7");
  assert.equal(contract.provider.defaultDescriptorId, "codex-exec-standard-v7");
  assert.equal(contract.provider.defaultDescriptorDigest, EXPECTED_DESCRIPTOR_DIGEST);

  const validateRun = await runCli(["validate", target], {
    cwd: owner,
    environment: noLifecycleEnvironment,
    timeoutMs: 60_000,
    privateValues,
  });
  assert.equal(validateRun.result.status, "completed");
  assert.equal(validateRun.result.observation.repository.initialized, true);
  assert.equal(
    validateRun.result.observation.repository.valid,
    true,
    JSON.stringify(validateRun.result.diagnostics),
  );
  assert.equal(
    validateRun.result.observation.repository.repositoryContract,
    "lifecycle.repository.v22",
  );
  assertDigest(
    validateRun.result.observation.repository.repositoryContractDigest,
    "Repository Contract digest",
  );
  assert.equal(validateRun.result.observation.delivery, null);

  await writeFile(prepareInput, DIRECTOR_BRIEF, "utf8");
  const canonicalHead = (await git(target, ["rev-parse", "HEAD"])).stdout.trim();
  qualificationCustodyAllocated = true;
  const initialPrepareRun = await runCli([
    "prepare", target,
    "--input", prepareInput,
  ], {
    cwd: owner,
    environment,
    timeoutMs: 30 * 60_000,
    privateValues,
  });
  assert.equal(initialPrepareRun.result.operation, "delivery.prepare");
  assert.match(initialPrepareRun.result.deliveryId, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
  const preparationRuns = [initialPrepareRun];
  let prepared = initialPrepareRun.result;
  for (let recoveryCount = 0;
    prepared.status === "recovery-required" && recoveryCount < 16;
    recoveryCount += 1) {
    const recovered = await runCli([
      "recover", target, initialPrepareRun.result.deliveryId,
    ], {
      cwd: owner,
      environment,
      timeoutMs: 30 * 60_000,
      privateValues,
    });
    assert.equal(recovered.result.operation, "delivery.recover");
    assert.equal(recovered.result.deliveryId, initialPrepareRun.result.deliveryId);
    preparationRuns.push(recovered);
    prepared = recovered.result;
  }
  assert.equal(prepared.status, "completed", JSON.stringify(prepared.diagnostics));
  assert.equal(prepared.deliveryId, initialPrepareRun.result.deliveryId);
  assert.equal(prepared.observation.delivery?.processId, prepared.deliveryId);
  assert.equal(
    prepared.observation.delivery?.standing,
    "awaiting-admission",
    JSON.stringify({
      diagnostics: prepared.diagnostics,
      standing: prepared.observation.delivery?.standing,
      eligibleOperations: prepared.observation.delivery?.eligibleOperations,
    }),
  );
  assert.equal(prepared.observation.delivery?.candidateCondition, "absent");
  assert(prepared.observation.delivery?.subjects.proposedBoundary !== null);
  assert.deepEqual(prepared.observation.delivery?.eligibleOperations, [
    "delivery.admit",
    "delivery.no-ship",
  ]);
  assert.equal(prepared.changes.repository.changed, false);
  assert.equal(prepared.changes.candidate.changed, false);
  assert.equal(prepared.changes.control.advanced, true);
  assert.equal((await git(target, ["rev-parse", "HEAD"])).stdout.trim(), canonicalHead);
  assert.equal((await git(target, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout, "");
  assert.equal(
    (await git(target, ["worktree", "list", "--porcelain"])).stdout
      .split("\n").filter((line) => line.startsWith("worktree ")).length,
    1,
    "Reconnaissance must not create a Candidate before admission",
  );

  const statusRun = await runCli(["status", target, prepared.deliveryId], {
    cwd: owner,
    environment: machineEnvironment,
    timeoutMs: 60_000,
    privateValues,
  });
  assert.equal(statusRun.result.status, "completed");
  assert.equal(
    statusRun.result.observation.delivery?.journal.headDigest,
    prepared.observation.delivery?.journal.headDigest,
  );

  const eventsInput = await writeQuery(privateRoot, "inspect-events.json", {
    kind: "events", afterSequence: 0, limit: 500,
  });
  const eventsRun = await runCli([
    "inspect", target, prepared.deliveryId, "--input", eventsInput,
  ], { cwd: owner, environment: machineEnvironment, timeoutMs: 60_000, privateValues });
  assertOrderedEvents(eventsRun.result.value.events);

  const attemptInput = await writeQuery(privateRoot, "inspect-attempt.json", {
    kind: "dossier", dossier: "attempt", afterRecordId: null, limit: 50,
  });
  const attemptRun = await runCli([
    "inspect", target, prepared.deliveryId, "--input", attemptInput,
  ], { cwd: owner, environment: machineEnvironment, timeoutMs: 60_000, privateValues });
  const records = attemptRun.result.value.records;
  assert.deepEqual(records.map(({ recordKind }) => recordKind).sort(), [
    "agent-attempt",
    "agent-work-product",
    "execution-receipt",
  ]);

  const boundaryInput = await writeQuery(privateRoot, "inspect-boundary.json", {
    kind: "dossier", dossier: "boundary", afterRecordId: null, limit: 50,
  });
  const boundaryRun = await runCli([
    "inspect", target, prepared.deliveryId, "--input", boundaryInput,
  ], { cwd: owner, environment: machineEnvironment, timeoutMs: 60_000, privateValues });
  const evidenceInput = await writeQuery(privateRoot, "inspect-evidence.json", {
    kind: "dossier", dossier: "evidence", afterRecordId: null, limit: 50,
  });
  const evidenceRun = await runCli([
    "inspect", target, prepared.deliveryId, "--input", evidenceInput,
  ], { cwd: owner, environment: machineEnvironment, timeoutMs: 60_000, privateValues });

  const attempt = exactRecord(records, "agent-attempt");
  const workProduct = exactRecord(records, "agent-work-product");
  const receipt = exactRecord(records, "execution-receipt");
  const boundary = exactRecord(boundaryRun.result.value.records, "work-boundary");
  const checkReceipt = exactRecord(evidenceRun.result.value.records, "check-receipt");

  assert.equal(attempt.payload.schema, "lifecycle.agent-attempt-payload.v3");
  assert.equal(attempt.payload.operation, "delivery.prepare");
  assert.equal(attempt.payload.role, "reconnaissance");
  assert.equal(attempt.payload.investment.model, selection.model);
  assert.equal(attempt.payload.investment.reasoning, selection.reasoning);
  assert.equal(attempt.payload.provider.adapter, "lifecycle.provider-adapter.v7");
  assert.equal(attempt.payload.provider.descriptorId, version.provider.defaultDescriptorId);
  assert.equal(attempt.payload.provider.descriptorDigest, version.provider.defaultDescriptorDigest);
  assert.equal(attempt.payload.provider.executableIdentityClass, "execution-image-tool-inventory-v1");
  assert.equal(
    attempt.payload.provider.installedIdentityDigest,
    selection.codexExecutableIdentity,
  );
  for (const [key, value] of Object.entries(attempt.payload.capability)) {
    if (key.endsWith("Digest")) assertDigest(value, `Attempt capability ${key}`);
  }
  assert.equal(
    attempt.payload.execution.backendProfile.profileId,
    "lifecycle.execution-backend-profile.docker-local.v1",
  );
  assertDigest(attempt.payload.execution.backendProfile.profileDigest, "Backend Profile digest");
  assertDigest(
    attempt.payload.execution.backendProfile.implementationDigest,
    "Backend implementation digest",
  );
  assert.equal(attempt.payload.execution.image.imageId, selection.imageId);
  assert.equal(attempt.payload.execution.image.imageDigest, selection.imageDigest);
  assert.equal(
    attempt.payload.execution.inputSet.profileId,
    "lifecycle.execution-input-set.v2",
  );
  assertDigest(attempt.payload.execution.inputSet.digest, "Agent Input Set digest");
  assertDigest(attempt.payload.input.contentInventoryDigest, "Agent content inventory digest");
  assert.deepEqual(Object.keys(attempt.payload.executionPolicy).sort(), EXECUTION_POLICY_KEYS);
  for (const key of EXECUTION_POLICY_KEYS) {
    assertDigest(attempt.payload.executionPolicy[key], `Agent execution policy ${key}`);
  }

  assert.equal(workProduct.payload.schema, "lifecycle.agent-work-product-payload.v5");
  assert.equal(workProduct.payload.role, "reconnaissance");
  assert.equal(workProduct.payload.disposition, "complete");
  assert.equal(workProduct.payload.roleSemantics.proposal, "work-boundary");
  assert(workProduct.payload.roleSemantics.workBoundary !== null);
  assert(workProduct.payload.claims.length >= 1);
  assert(workProduct.payload.citations.length >= 1);
  assert.equal(workProduct.semanticAuthority, "agent-proposed");

  assert.equal(boundary.payload.schema, "lifecycle.work-boundary-payload.v6");
  assert.equal(boundary.payload.basis.specificationRevision, "lifecycle.foundation.1.0.0-rc.17");
  assert.equal(boundary.payload.basis.repositoryContract, "lifecycle.repository.v22");
  assert.equal(boundary.payload.basis.providerAdapter, "lifecycle.provider-adapter.v7");
  assert.equal(boundary.semanticAuthority, "runtime-derived");
  assert.equal(checkReceipt.payload.schema, "lifecycle.check-receipt-payload.v3");
  assert.equal(checkReceipt.payload.phase, "baseline");
  assert.equal(checkReceipt.payload.modality, "regression-guard");
  assert.equal(checkReceipt.payload.disposition, "pass");
  assert.equal(checkReceipt.payload.binding.id, "live-provider-qualification-check");
  assert.equal(checkReceipt.payload.execution.allocation, "allocated");
  assertDigest(checkReceipt.payload.execution.specificationDigest, "Baseline Check specification digest");
  assertDigest(checkReceipt.payload.execution.observationDigest, "Baseline Check observation digest");
  assert.equal(checkReceipt.payload.containment.classification, "contained");
  assert.equal(checkReceipt.payload.retirement.classification, "retired");
  assert.equal(checkReceipt.semanticAuthority, "runtime-observed");

  assert.equal(receipt.payload.schema, "lifecycle.execution-receipt-payload.v3");
  assert.equal(receipt.payload.provider.adapter, "lifecycle.provider-adapter.v7");
  assert.equal(receipt.payload.provider.descriptorId, version.provider.defaultDescriptorId);
  assert.equal(receipt.payload.provider.descriptorDigest, version.provider.defaultDescriptorDigest);
  assert.equal(receipt.payload.provider.installedIdentityDigest, selection.codexExecutableIdentity);
  assert.equal(receipt.payload.provider.observedExecutableIdentity, selection.codexExecutableIdentity);
  assert.equal(receipt.payload.provider.model, selection.model);
  assert.equal(receipt.payload.provider.terminalReason, "valid-submission");
  assert.equal(receipt.payload.productiveExecutionStarted, true);
  assert.equal(receipt.payload.inputBindings.contentInventoryDigest,
    attempt.payload.input.contentInventoryDigest);
  assert.deepEqual(receipt.payload.execution.backendProfile, attempt.payload.execution.backendProfile);
  assert.deepEqual(receipt.payload.execution.image, attempt.payload.execution.image);
  assert.deepEqual(receipt.payload.execution.inputSet, attempt.payload.execution.inputSet);
  for (const key of ["specificationDigest", "runnerDigest", "observationDigest"]) {
    assertDigest(receipt.payload.execution[key], `Execution Receipt ${key}`);
  }
  assert.equal(receipt.payload.execution.output.availability, "retrieved");
  assert(receipt.payload.execution.output.carrierByteLength > 0);
  assertDigest(receipt.payload.execution.output.carrierDigest, "Agent output carrier digest");
  assertDigest(receipt.payload.execution.output.manifestDigest, "Agent output manifest digest");
  assert.equal(receipt.payload.workspace.availability, "available");
  assert.equal(receipt.payload.workspace.parserDisposition, "valid");
  assert.equal(receipt.payload.workspace.compilerDisposition, "retained");
  assert.equal(receipt.payload.workProduct.disposition, "submitted");
  assert(receipt.payload.workProduct.reference !== null);
  assert.equal(receipt.payload.candidate.input, null);
  assert.equal(receipt.payload.candidate.successorDisposition, null);
  assert.equal(receipt.payload.candidate.successor, null);
  assert.equal(receipt.payload.containment.classification, "contained");
  assert.equal(receipt.payload.containment.cancellationRequested, false);
  assert.equal(receipt.payload.containment.forced, false);
  assert.equal(receipt.payload.containment.parentLoss, "not-observed");
  assertDigest(receipt.payload.containment.factsDigest, "Containment facts digest");
  assert.equal(receipt.payload.retirement.classification, "retired");
  assert(["none", "bounded-non-secret"].includes(receipt.payload.retirement.residualClass));
  assert.equal(
    receipt.payload.retirement.residualFactsDigest === null,
    receipt.payload.retirement.residualClass === "none",
  );
  assertDigest(receipt.payload.retirement.factsDigest, "Retirement facts digest");
  if (receipt.payload.retirement.residualFactsDigest !== null) {
    assertDigest(receipt.payload.retirement.residualFactsDigest, "Retirement residual facts digest");
  }
  assert.equal(receipt.semanticAuthority, "runtime-observed");

  assert.deepEqual(
    boundary.payload.knowledge.map(({ id }) => id).sort(),
    ["check.live-provider-qualification", "description.docker-agent-qualification"],
  );
  assert.equal(boundary.payload.mandate.obligations.length, 1);
  assert.equal(boundary.payload.mandate.obligations[0].kind, "behavior");
  assert.equal(boundary.payload.mandate.obligations[0].severity, "required");
  assert.deepEqual(boundary.payload.mandate.obligations[0].sourceIds, [
    "description.docker-agent-qualification",
    boundary.payload.mandate.direction.id,
  ].sort());
  assert.deepEqual(boundary.payload.mandate.artifacts.map(({ path, role, mustChange }) => ({
    path,
    role,
    mustChange,
  })), [{ path: "docs/qualification.md", role: "documentation", mustChange: true }]);
  assert.equal(boundary.payload.mandate.checks.length, 1);
  assert.equal(boundary.payload.mandate.checks[0].modality, "regression-guard");
  assert.equal(boundary.payload.mandate.checks[0].baselineRequired, true);
  assert.equal(boundary.payload.mandate.checks[0].finalRequired, true);
  assert.deepEqual(
    boundary.payload.mandate.checks[0].bindings.map(({ id }) => id),
    ["live-provider-qualification-check"],
  );
  assert.equal(boundary.payload.mandate.acceptancePropositions.length, 1);
  assert(boundary.payload.mandate.acceptancePropositions[0].evidenceKinds.includes("diff"));
  assert.equal(
    boundary.payload.mandate.acceptancePropositions[0].checkId,
    boundary.payload.mandate.checks[0].id,
  );

  const deliveryId = prepared.deliveryId;
  const operationOptions = Object.freeze({
    cwd: owner,
    environment,
    timeoutMs: 30 * 60_000,
    privateValues,
  });
  const admittedOperation = await runRecoverableMutation({
    args: [
      "admit", target, deliveryId,
      "--authority-secret-file", authorityFile,
    ],
    target,
    deliveryId,
    options: operationOptions,
  });
  const admitted = admittedOperation.result;
  assert.equal(admitted.observation.delivery?.standing, "active");
  assert.equal(admitted.observation.delivery?.candidateCondition, "ready-for-work");
  assert.deepEqual(admitted.observation.delivery?.eligibleOperations, [
    "delivery.continue",
    "delivery.integrate",
    "delivery.no-ship",
  ]);
  const initialCandidate = admitted.observation.delivery?.subjects.candidate;
  assert(initialCandidate !== null && initialCandidate !== undefined);
  assert.equal(admitted.observation.delivery?.subjects.activeBoundary?.digest, boundary.digest);
  assert.equal(admitted.observation.delivery?.subjects.proposedBoundary, null);
  assert.equal((await git(target, ["rev-parse", "HEAD"])).stdout.trim(), canonicalHead);
  assert.equal((await git(target, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout, "");
  assert.equal(
    (await git(target, ["worktree", "list", "--porcelain"])).stdout
      .split("\n").filter((line) => line.startsWith("worktree ")).length,
    1,
    "Admission must not create a persistent Candidate worktree",
  );

  const admittedViewRun = await inspectDeliveryView({
    privateRoot,
    suffix: "admitted",
    target,
    deliveryId,
    options: operationOptions,
  });
  const admittedGeneration = admittedViewRun.result.value.view.generation.digest;

  await writeFile(continueInput, BUILDER_DIRECTION, "utf8");
  const continuedOperation = await runRecoverableMutation({
    args: [
      "continue", target, deliveryId,
      "--input", continueInput,
      "--expected-generation", admittedGeneration,
    ],
    target,
    deliveryId,
    options: operationOptions,
  });
  const continued = continuedOperation.result;
  assert.equal(continued.observation.delivery?.standing, "active");
  assert.equal(continued.observation.delivery?.candidateCondition, "ready-for-work");
  assert.deepEqual(continued.observation.delivery?.eligibleOperations, [
    "delivery.continue",
    "delivery.integrate",
    "delivery.no-ship",
  ]);
  const successorCandidate = continued.observation.delivery?.subjects.candidate;
  assert(successorCandidate !== null && successorCandidate !== undefined);
  assert.equal(successorCandidate.id, initialCandidate.id);
  assert.equal(successorCandidate.revision, initialCandidate.revision + 1);
  assert.notEqual(successorCandidate.digest, initialCandidate.digest);
  assert.equal(continued.changes.repository.changed, false);
  assert.equal((await git(target, ["rev-parse", "HEAD"])).stdout.trim(), canonicalHead);
  assert.equal((await git(target, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout, "");
  assert.equal(
    (await git(target, ["worktree", "list", "--porcelain"])).stdout
      .split("\n").filter((line) => line.startsWith("worktree ")).length,
    1,
    "Productive work must not retain a persistent Candidate worktree",
  );

  const candidateDiffInput = await writeQuery(privateRoot, "candidate-diff.json", {
    subject: "candidate",
    maximumBytes: 1024 * 1024,
  });
  const candidateDiffRun = await runCli([
    "diff", target, deliveryId, "--input", candidateDiffInput,
  ], {
    cwd: owner,
    environment: machineEnvironment,
    timeoutMs: 120_000,
    privateValues,
  });
  const candidateDiff = candidateDiffRun.result.value.view;
  assert.equal(candidateDiff.schema, "lifecycle.delivery-diff.v1");
  assert.equal(candidateDiff.subject, "candidate");
  assert.equal(candidateDiff.currentness, "exact");
  assert.equal(candidateDiff.candidate.digest, successorCandidate.digest);
  assert.equal(candidateDiff.baseCommit, canonicalHead);
  assert.equal(candidateDiff.truncated, false);
  assert.equal(candidateDiff.unavailableReason, null);
  assert.equal((candidateDiff.content.match(/^diff --git /gmu) ?? []).length, 1);
  assert.match(candidateDiff.content, /^diff --git a\/docs\/qualification\.md b\/docs\/qualification\.md$/mu);
  assert.match(candidateDiff.content, /^-Status: pending$/mu);
  assert.match(candidateDiff.content, /^\+Status: complete$/mu);
  assert.doesNotMatch(candidateDiff.content, /checks\/verify-qualification-state/u);

  const continuedViewRun = await inspectDeliveryView({
    privateRoot,
    suffix: "continued",
    target,
    deliveryId,
    options: operationOptions,
  });
  const continuedGeneration = continuedViewRun.result.value.view.generation.digest;

  // This is explicit Director-directed maintenance by the qualification harness,
  // outside Delivery. Atlas root semantics change while all mandate fields and
  // selected Knowledge bytes remain exact, making reaffirmation lawful.
  const atlasPath = join(target, "atlas", "atlas.md");
  const maintainedAtlas = `${await readFile(atlasPath, "utf8")}${ATLAS_MAINTENANCE}`;
  await writeFile(atlasPath, maintainedAtlas, "utf8");
  await git(target, ["add", "--", "atlas/atlas.md"]);
  await git(target, ["commit", "-m", "Clarify separately maintained qualification context"]);
  const canonicalParent = (await git(target, ["rev-parse", "HEAD"])).stdout.trim();
  assert.notEqual(canonicalParent, canonicalHead);
  assert.equal((await git(target, ["rev-parse", "HEAD^"])).stdout.trim(), canonicalHead);

  const contextIntegrationOperation = await runRecoverableMutation({
    args: ["integrate", target, deliveryId, "--expected-generation", continuedGeneration],
    target,
    deliveryId,
    options: operationOptions,
  });
  const contextIntegrated = contextIntegrationOperation.result;
  assert.equal(contextIntegrated.observation.delivery?.standing, "boundary-paused");
  assert.equal(contextIntegrated.observation.delivery?.candidateCondition, "paused-for-boundary");
  assert.deepEqual(contextIntegrated.observation.delivery?.eligibleOperations, [
    "delivery.revise", "delivery.reaffirm", "delivery.no-ship",
  ]);
  const frozenCandidate = contextIntegrated.observation.delivery?.subjects.candidate;
  const contextAssessment = contextIntegrated.observation.delivery?.subjects.integrationAssessment;
  const materialCondition = contextIntegrated.observation.delivery?.subjects.materialCondition;
  assert(frozenCandidate && contextAssessment && materialCondition);
  assert.equal(frozenCandidate.id, successorCandidate.id);
  assert.equal(frozenCandidate.revision, successorCandidate.revision + 1);
  const inspection = { privateRoot, target, deliveryId, options: operationOptions };
  const frozenRun = await inspectExactRecord(inspection, frozenCandidate);
  const assessmentRun = await inspectExactRecord(inspection, contextAssessment);
  const conditionRun = await inspectExactRecord(inspection, materialCondition);
  assert.equal(frozenRun.record.payload.candidateBaseCommit, canonicalParent);
  assertRelated(frozenRun.record, "revises", successorCandidate);
  assertRelated(frozenRun.record, "integrated-from", contextAssessment);
  assert.equal(assessmentRun.record.payload.outcome, "constructed");
  assert.equal(assessmentRun.record.payload.canonicalParent.commit, canonicalParent);
  assert.equal(assessmentRun.record.payload.contextualApplicability.disposition, "requires-readmission");
  assert.deepEqual(assessmentRun.record.payload.contextualApplicability.changes.map(({ subject }) => subject), ["atlas"]);
  assert.equal(conditionRun.record.payload.conditionClass, "integration-context-change");
  assert.deepEqual(conditionRun.record.payload.source, { kind: "integration-assessment" });
  assertRelated(conditionRun.record, "reported-by", contextAssessment);
  assertRelated(conditionRun.record, "freezes", frozenCandidate);
  assert.equal(contextIntegrated.changes.repository.changed, false);

  const frozenViewRun = await inspectDeliveryView({ ...inspection, suffix: "frozen" });
  await writeFile(reaffirmInput, resolutionDirection(boundary, frozenRun.record, workProduct), "utf8");
  const reaffirmedOperation = await runRecoverableMutation({
    args: ["reaffirm", target, deliveryId, "--input", reaffirmInput,
      "--expected-generation", frozenViewRun.result.value.view.generation.digest],
    target, deliveryId, options: operationOptions,
  });
  const reaffirmed = reaffirmedOperation.result;
  assert.equal(reaffirmed.observation.delivery?.standing, "awaiting-readmission");
  assert.equal(reaffirmed.observation.delivery?.subjects.candidate?.digest, frozenCandidate.digest);
  assert.equal(reaffirmed.observation.delivery?.subjects.activeBoundary?.digest, boundary.digest);
  assert.equal(reaffirmed.observation.delivery?.subjects.materialCondition?.digest, materialCondition.digest);
  assert.equal(reaffirmed.changes.candidate.changed, false);
  assert.equal(reaffirmed.changes.repository.changed, false);
  const successorBoundary = reaffirmed.observation.delivery?.subjects.proposedBoundary;
  assert(successorBoundary);
  const successorBoundaryRun = await inspectExactRecord(inspection, successorBoundary);
  assert.equal(successorBoundary.id, boundary.recordId);
  assert.equal(successorBoundary.revision, boundary.revision + 1);
  assert.equal(successorBoundaryRun.record.payload.proposalKind, "reaffirmation");
  assert.equal(successorBoundaryRun.record.payload.basis.productBaseCommit, canonicalParent);
  assert.deepEqual(successorBoundaryRun.record.payload.resolution.changedMandateFields, []);
  for (const field of ["mandate", "knowledge", "disciplines", "externalSources", "capabilityProfile", "projectionProfile"]) {
    assert.deepEqual(successorBoundaryRun.record.payload[field], boundary.payload[field]);
  }
  assertRelated(successorBoundaryRun.record, "revises", admitted.observation.delivery.subjects.activeBoundary);
  assertRelated(successorBoundaryRun.record, "resolves", materialCondition);
  const readmittedOperation = await runRecoverableMutation({
    args: ["admit", target, deliveryId, "--authority-secret-file", authorityFile],
    target, deliveryId, options: operationOptions,
  });
  const readmitted = readmittedOperation.result;
  assert.equal(readmitted.observation.delivery?.standing, "active");
  assert.equal(readmitted.observation.delivery?.subjects.activeBoundary?.digest, successorBoundary.digest);
  assert.equal(readmitted.observation.delivery?.subjects.materialCondition, null);
  const reboundCandidate = readmitted.observation.delivery?.subjects.candidate;
  assert(reboundCandidate);
  const reboundRun = await inspectExactRecord(inspection, reboundCandidate);
  assert.equal(reboundCandidate.id, frozenCandidate.id);
  assert.equal(reboundCandidate.revision, frozenCandidate.revision + 1);
  assert.equal(reboundRun.record.payload.observation, "readmission-rebind");
  assert.equal(reboundRun.record.payload.candidateBaseCommit, canonicalParent);
  assert.deepEqual(reboundRun.record.payload.state, frozenRun.record.payload.state);
  assert.deepEqual(reboundRun.record.payload.carrierManifest, frozenRun.record.payload.carrierManifest);
  assertRelated(reboundRun.record, "revises", frozenCandidate);
  assertRelated(reboundRun.record, "governed-by", successorBoundary);
  const readmittedViewRun = await inspectDeliveryView({ ...inspection, suffix: "readmitted" });
  const integratedOperation = await runRecoverableMutation({
    args: ["integrate", target, deliveryId, "--expected-generation", readmittedViewRun.result.value.view.generation.digest],
    target, deliveryId, options: operationOptions,
  });
  const integrated = integratedOperation.result;
  const integratedCandidate = integrated.observation.delivery?.subjects.candidate;
  const integrationAssessment = integrated.observation.delivery?.subjects.integrationAssessment;
  assert(integratedCandidate !== null && integratedCandidate !== undefined);
  assert(integrationAssessment !== null && integrationAssessment !== undefined);
  const finalAssessmentRun = await inspectExactRecord(inspection, integrationAssessment);
  assert.equal(finalAssessmentRun.record.payload.canonicalParent.commit, canonicalParent);
  assert.deepEqual(finalAssessmentRun.record.payload.contextualApplicability, { disposition: "unchanged", changes: [] });
  assertRelated(finalAssessmentRun.record, "integrates", reboundCandidate);
  assertRelated(finalAssessmentRun.record, "governed-by", successorBoundary);
  assert.equal(integratedCandidate.id, successorCandidate.id);
  assert.equal(integratedCandidate.revision, reboundCandidate.revision + 1);
  assert.equal(integrated.observation.delivery?.standing, "active");
  assert.deepEqual(integrated.observation.delivery?.eligibleOperations, [
    "delivery.continue", "delivery.integrate", "delivery.evaluate", "delivery.no-ship",
  ]);
  assert.equal(integrated.changes.repository.changed, false);
  assert.equal((await git(target, ["rev-parse", "HEAD"])).stdout.trim(), canonicalParent);
  const integratedViewRun = await inspectDeliveryView({
    privateRoot, suffix: "integrated", target, deliveryId, options: operationOptions,
  });
  const integratedGeneration = integratedViewRun.result.value.view.generation.digest;

  await writeFile(evaluateInput, REVIEWER_DIRECTION, "utf8");
  const evaluatedOperation = await runRecoverableMutation({
    args: [
      "evaluate", target, deliveryId,
      "--input", evaluateInput,
      "--expected-generation", integratedGeneration,
    ],
    target,
    deliveryId,
    options: operationOptions,
  });
  const evaluated = evaluatedOperation.result;
  assert.equal(evaluated.observation.delivery?.standing, "decision-ready");
  assert.equal(evaluated.observation.delivery?.candidateCondition, "ready-for-decision");
  assert.deepEqual(evaluated.observation.delivery?.eligibleOperations, [
    "delivery.integrate",
    "delivery.accept",
    "delivery.no-ship",
  ]);
  assert.equal(evaluated.observation.delivery?.subjects.candidate?.digest, integratedCandidate.digest);
  assert(evaluated.observation.delivery?.subjects.seal !== null);
  assert(evaluated.observation.delivery?.subjects.evidence !== null);
  assert.equal((await git(target, ["rev-parse", "HEAD"])).stdout.trim(), canonicalParent);
  assert.equal((await git(target, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout, "");
  assert.equal(
    (await git(target, ["worktree", "list", "--porcelain"])).stdout
      .split("\n").filter((line) => line.startsWith("worktree ")).length,
    1,
    "Evaluation must not retain a persistent Candidate worktree",
  );

  const acceptedOperation = await runRecoverableMutation({
    args: [
      "accept", target, deliveryId,
      "--authority-secret-file", authorityFile,
    ],
    target,
    deliveryId,
    options: operationOptions,
  });
  const accepted = acceptedOperation.result;
  assert.equal(accepted.observation.delivery?.standing, "closed");
  assert.equal(accepted.observation.delivery?.candidateCondition, "accepted");
  assert.deepEqual(accepted.observation.delivery?.eligibleOperations, []);
  assert.equal(accepted.observation.delivery?.subjects.candidate?.digest, integratedCandidate.digest);
  assert(accepted.observation.delivery?.subjects.closure !== null);

  const acceptedHead = (await git(target, ["rev-parse", "HEAD"])).stdout.trim();
  const acceptedParent = (await git(target, ["rev-parse", "HEAD^"])).stdout.trim();
  const acceptedTree = (await git(target, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
  assert.notEqual(acceptedHead, canonicalHead);
  assert.equal(acceptedParent, canonicalParent);
  assert.equal(await readFile(join(target, "docs", "qualification.md"), "utf8"),
    COMPLETE_QUALIFICATION_DOCUMENT);
  assert.equal(await readFile(atlasPath, "utf8"), maintainedAtlas);
  assert.equal((await git(target, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout, "");
  assert.equal(
    (await git(target, ["worktree", "list", "--porcelain"])).stdout
      .split("\n").filter((line) => line.startsWith("worktree ")).length,
    1,
    "Acceptance must leave only the canonical target worktree",
  );
  assert.equal(
    (await git(target, ["diff-tree", "--no-commit-id", "--name-only", "-r", acceptedHead])).stdout,
    "docs/qualification.md\n",
  );

  const terminalStatusRun = await runCli(["status", target, deliveryId], {
    cwd: owner,
    environment: machineEnvironment,
    timeoutMs: 60_000,
    privateValues,
  });
  const terminalDelivery = terminalStatusRun.result.observation.delivery;
  assert.equal(terminalDelivery?.standing, "closed");
  assert.equal(terminalDelivery?.candidateCondition, "accepted");
  assert.equal(terminalDelivery?.storeDisposition.stage, "archived");
  assert.equal(terminalDelivery?.storeDisposition.integrity, "verified");
  assertDigest(terminalDelivery?.storeDisposition.sealSubjectDigest, "Control Store seal subject digest");
  assertDigest(terminalDelivery?.storeDisposition.archiveManifestDigest, "Control Store archive manifest digest");
  const activeTargetRegistry = join(registryRoot, "active", targetRegistrySegment);
  const stagingTargetRegistry = join(registryRoot, "staging", targetRegistrySegment);
  assert.equal((await lstat(activeTargetRegistry)).isDirectory(), true);
  assert.deepEqual(await readdir(activeTargetRegistry), []);
  assert.equal((await lstat(stagingTargetRegistry)).isDirectory(), true);
  assert.deepEqual(await readdir(stagingTargetRegistry), []);
  assert.equal((await lstat(join(registryRoot, "archive", targetRegistrySegment))).isDirectory(), true);

  const terminalEventsInput = await writeQuery(privateRoot, "inspect-terminal-events.json", {
    kind: "events", afterSequence: 0, limit: 500,
  });
  const terminalEventsRun = await runCli([
    "inspect", target, deliveryId, "--input", terminalEventsInput,
  ], { cwd: owner, environment: machineEnvironment, timeoutMs: 60_000, privateValues });
  const terminalEvents = terminalEventsRun.result.value.events;
  const recoveryEvents = terminalEvents.filter(({ eventKind }) =>
    eventKind === "activity-recovery-recorded");
  assert.deepEqual(
    terminalEvents.filter(({ eventKind }) => eventKind !== "activity-recovery-recorded")
      .map(({ eventKind }) => eventKind),
    EXPECTED_TERMINAL_EVENT_KINDS,
  );
  assert.equal(terminalEvents.length, EXPECTED_TERMINAL_EVENT_KINDS.length + recoveryEvents.length);
  assert.equal(terminalEvents.at(-1)?.eventKind, "closure-recorded");
  assert.equal(terminalDelivery?.journal.eventCount, terminalEvents.length);
  assert.equal(terminalDelivery?.journal.headDigest, terminalEvents.at(-1)?.digest);

  const terminalAttemptRun = await inspectDossier({
    privateRoot,
    suffix: "terminal",
    dossier: "attempt",
    target,
    deliveryId,
    options: { cwd: owner, environment: machineEnvironment, timeoutMs: 60_000, privateValues },
  });
  const terminalCandidateRun = await inspectDossier({
    privateRoot,
    suffix: "terminal",
    dossier: "candidate",
    target,
    deliveryId,
    options: { cwd: owner, environment: machineEnvironment, timeoutMs: 60_000, privateValues },
  });
  const candidateRevisionsInput = await writeQuery(privateRoot, "inspect-candidate-revisions.json", {
    kind: "revisions",
    recordId: successorCandidate.id,
    afterRevision: 0,
    limit: 200,
  });
  const candidateRevisionsRun = await runCli([
    "inspect", target, deliveryId, "--input", candidateRevisionsInput,
  ], { cwd: owner, environment: machineEnvironment, timeoutMs: 60_000, privateValues });
  const terminalEvidenceRun = await inspectDossier({
    privateRoot,
    suffix: "terminal",
    dossier: "evidence",
    target,
    deliveryId,
    options: { cwd: owner, environment: machineEnvironment, timeoutMs: 60_000, privateValues },
  });
  const terminalDecisionRun = await inspectDossier({
    privateRoot,
    suffix: "terminal",
    dossier: "decision",
    target,
    deliveryId,
    options: { cwd: owner, environment: machineEnvironment, timeoutMs: 60_000, privateValues },
  });
  const terminalClosureRun = await inspectDossier({
    privateRoot,
    suffix: "terminal",
    dossier: "closure",
    target,
    deliveryId,
    options: { cwd: owner, environment: machineEnvironment, timeoutMs: 60_000, privateValues },
  });

  const attemptRecords = terminalAttemptRun.result.value.records;
  const agentAttempts = recordsOfKind(attemptRecords, "agent-attempt");
  const workProducts = recordsOfKind(attemptRecords, "agent-work-product");
  const executionReceipts = recordsOfKind(attemptRecords, "execution-receipt");
  assert.equal(agentAttempts.length, 4);
  assert.equal(workProducts.length, 4);
  assert.equal(executionReceipts.length, 4);
  assert.deepEqual(agentAttempts.map(({ payload }) => payload.role).sort(), [
    "builder", "reconnaissance", "reconnaissance", "reviewer",
  ]);
  assert.deepEqual(workProducts.map(({ payload }) => payload.role).sort(), [
    "builder", "reconnaissance", "reconnaissance", "reviewer",
  ]);
  for (const selected of executionReceipts) {
    assert.equal(selected.payload.execution.backendProfile.profileId,
      "lifecycle.execution-backend-profile.docker-local.v1");
    assert.equal(selected.payload.execution.image.imageDigest, selection.imageDigest);
    assert.equal(selected.payload.containment.classification, "contained");
    assert.equal(selected.payload.retirement.classification, "retired");
  }
  const builderAttempt = agentAttempts.find(({ payload }) => payload.role === "builder");
  const resolutionAttempt = agentAttempts.find(({ payload }) => payload.operation === "delivery.reaffirm");
  const reviewerAttempt = agentAttempts.find(({ payload }) => payload.role === "reviewer");
  assert(builderAttempt !== undefined && resolutionAttempt !== undefined && reviewerAttempt !== undefined);
  assertRelated(resolutionAttempt, "uses-boundary", admitted.observation.delivery.subjects.activeBoundary);
  assertRelated(resolutionAttempt, "uses-candidate", frozenCandidate);
  assert.equal(resolutionAttempt.payload.capability.profileId, boundary.payload.capabilityProfile.id);
  assert.equal(resolutionAttempt.payload.capability.profileDigest, boundary.payload.capabilityProfile.digest);
  const selectedCapability = contract.capabilityProfiles[boundary.payload.capabilityProfile.id];
  assert.equal(resolutionAttempt.payload.capability.effectiveGrantDigest, digestCanonical({
    candidateWrites: false,
    temporaryWrites: selectedCapability.temporaryWrites,
    subprocesses: selectedCapability.subprocesses,
    network: selectedCapability.network.mode,
    credentials: selectedCapability.credentials,
    externalEffects: [],
  }));
  const resolutionReceipt = executionReceipts.find(({ relationships }) => relationships.some(({ relation, target: selected }) =>
    relation === "observes-attempt" && selected.id === resolutionAttempt.recordId));
  assert(resolutionReceipt !== undefined);
  // The Attempt and Input Set bind read-only input. Receipt Candidate fields
  // describe output observation and remain empty for reconnaissance.
  assert.equal(resolutionReceipt.payload.candidate.input, null);
  assert.equal(resolutionReceipt.payload.candidate.successorDisposition, null);
  assert.equal(resolutionReceipt.payload.candidate.successor, null);
  assert.equal(resolutionReceipt.payload.candidate.contentDisposition, null);
  assert.equal(resolutionReceipt.relationships.some(({ relation }) => relation === "observes-candidate"), false);
  assert.deepEqual(resolutionReceipt.payload.execution.inputSet, resolutionAttempt.payload.execution.inputSet);
  assert.equal(resolutionReceipt.payload.workspace.parserDisposition, "valid");
  assert.equal(resolutionReceipt.payload.workspace.compilerDisposition, "retained");
  const resolutionProduct = workProducts.find(({ relationships }) => relationships.some(({ relation, target: selected }) =>
    relation === "result-of" && selected.id === resolutionAttempt.recordId));
  assert(resolutionProduct !== undefined);
  const resolutionProductReference = { kind: "agent-work-product", id: resolutionProduct.recordId,
    revision: resolutionProduct.revision, digest: resolutionProduct.digest };
  assert.equal(resolutionProduct.payload.role, "reconnaissance");
  assert.equal(resolutionProduct.payload.disposition, "complete");
  assertRelated(successorBoundaryRun.record, "proposed-from", resolutionProductReference);
  assertRelated(resolutionReceipt, "observes-work-product", resolutionProductReference);
  assert.equal(terminalEvents.some((event) => event.payload.activityId === resolutionAttempt.payload.activityId &&
    event.eventKind === "candidate-revision-observed"), false);
  const builderReceipt = executionReceipts.find(({ relationships }) => relationships.some(({ relation, target: selected }) =>
    relation === "observes-attempt" && selected.id === builderAttempt.recordId));
  const reviewerReceipt = executionReceipts.find(({ relationships }) => relationships.some(({ relation, target: selected }) =>
    relation === "observes-attempt" && selected.id === reviewerAttempt.recordId));
  assert(builderReceipt !== undefined && reviewerReceipt !== undefined);
  for (const [selectedAttempt, selectedReceipt] of [
    [builderAttempt, builderReceipt], [resolutionAttempt, resolutionReceipt], [reviewerAttempt, reviewerReceipt],
  ]) {
    assertRelated(selectedReceipt, "observes-attempt", { kind: "agent-attempt", id: selectedAttempt.recordId,
      revision: selectedAttempt.revision, digest: selectedAttempt.digest });
  }
  assert.equal(builderReceipt.payload.candidate.input.revision.digest, initialCandidate.digest);
  assert.equal(builderReceipt.payload.candidate.successorDisposition, "promoted");
  assert.equal(builderReceipt.payload.candidate.successor.revision.digest, successorCandidate.digest);
  assert.equal(reviewerReceipt.payload.candidate.input.revision.digest, integratedCandidate.digest);
  assert.equal(reviewerReceipt.payload.candidate.successorDisposition, null);
  assert.equal(reviewerReceipt.payload.candidate.successor, null);

  const currentCandidateRecords = recordsOfKind(
    terminalCandidateRun.result.value.records,
    "candidate-revision",
  );
  assert.equal(currentCandidateRecords.length, 1);
  assert.equal(currentCandidateRecords[0].digest, integratedCandidate.digest);
  const candidateRecords = candidateRevisionsRun.result.value.records;
  assert.equal(candidateRecords.length, 5);
  assert.deepEqual(candidateRecords.map(({ payload }) => payload.observation), [
    "initialization", "builder-successor", "integration-successor", "readmission-rebind", "integration-successor",
  ]);
  assert.deepEqual(candidateRecords[1].payload.state.changedSubjects, [{
    path: "docs/qualification.md",
    change: "modified",
    beforeDigest: sha256(PENDING_QUALIFICATION_DOCUMENT),
    afterDigest: sha256(COMPLETE_QUALIFICATION_DOCUMENT),
  }]);
  assert.notEqual(candidateRecords[1].payload.state.tree, acceptedTree, "P contributes maintained Atlas bytes independently of Product work");
  for (const record of candidateRecords.slice(2)) {
    assert.equal(record.payload.state.tree, acceptedTree);
    assert.equal(record.payload.candidateBaseCommit, canonicalParent);
  }
  assert.deepEqual(candidateRecords[3].payload.state, candidateRecords[2].payload.state);
  assert.deepEqual(candidateRecords[3].payload.carrierManifest, candidateRecords[2].payload.carrierManifest);
  assertRelated(candidateRecords[2], "integrated-from", contextAssessment);
  assertRelated(candidateRecords[4], "integrated-from", integrationAssessment);
  assertRelated(candidateRecords[4], "revises", reboundCandidate);
  assertRelated(candidateRecords[4], "governed-by", successorBoundary);

  const evidenceRecords = terminalEvidenceRun.result.value.records;
  const checkReceipts = recordsOfKind(evidenceRecords, "check-receipt");
  const seals = recordsOfKind(evidenceRecords, "candidate-seal");
  const packets = recordsOfKind(evidenceRecords, "evidence-packet");
  assert.equal(checkReceipts.length, 3);
  assert.equal(seals.length, 1);
  assert.equal(packets.length, 1);
  assert.deepEqual(checkReceipts.map(({ payload }) => payload.phase).sort(), ["baseline", "baseline", "final"]);
  const successorBaseline = checkReceipts.find(({ payload, relationships }) => payload.phase === "baseline" &&
    relationships.some(({ relation, target: selected }) => relation === "checks-boundary" && selected.digest === successorBoundary.digest));
  assert(successorBaseline !== undefined);
  assert.notEqual(successorBaseline.digest, checkReceipt.digest);
  for (const selected of checkReceipts) {
    assert.equal(selected.payload.disposition, "pass");
    assert.equal(selected.payload.modality, "regression-guard");
    assert.equal(selected.payload.execution.allocation, "allocated");
    assert.equal(selected.payload.execution.image.imageDigest, selection.imageDigest);
    assert.equal(selected.payload.containment.classification, "contained");
    assert.equal(selected.payload.retirement.classification, "retired");
  }
  const finalCheckReceipt = checkReceipts.find(({ payload }) => payload.phase === "final");
  assert(finalCheckReceipt !== undefined);
  assert.equal(packets[0].payload.readiness, "acceptance-ready");
  assert.equal(packets[0].payload.diagnostics.length, 0);
  assert.equal(packets[0].payload.propositionDecisions.length, 1);
  assert.equal(packets[0].payload.propositionDecisions[0].reviewerDisposition, "accepted");

  const decisions = recordsOfKind(terminalDecisionRun.result.value.records, "director-decision");
  assert.equal(decisions.length, 3);
  assert.deepEqual(decisions.map(({ payload }) => payload.decision).sort(), ["accept", "admit", "readmit"]);
  const closure = exactRecord(terminalClosureRun.result.value.records, "closure");
  assert.equal(closure.payload.schema, "lifecycle.closure-payload.v6");
  assert.equal(closure.payload.disposition, "accepted");
  assert.equal(closure.payload.candidateTreatment, "integrated");
  assert.equal(closure.payload.nonIntegrationVerified, false);
  assert.equal(closure.payload.canonicalResult.parentCommit, canonicalParent);
  assert.equal(closure.payload.canonicalResult.commit, acceptedHead);
  assert.equal(closure.payload.canonicalResult.tree, acceptedTree);
  assert.equal(closure.payload.canonicalResult.candidateDigest,
    candidateRecords[4].payload.state.candidateDigest);
  assert.equal(closure.payload.terminalExecutions.executionCount, 7);
  assert.equal(closure.payload.terminalExecutions.containment.classification, "complete");
  assert.equal(closure.payload.terminalExecutions.retirement.classification, "complete");
  assert.equal(closure.payload.reclamationHandoff.obligationCount, 7);
  assertDigest(closure.payload.reclamationHandoff.obligationSetDigest,
    "Closure Reclamation obligation-set digest");

  const decisionDiffInput = await writeQuery(privateRoot, "decision-diff.json", {
    subject: "decision",
    maximumBytes: 1024 * 1024,
  });
  const archivedDiffRun = await runCli([
    "diff", target, deliveryId, "--input", decisionDiffInput,
  ], {
    cwd: owner,
    environment: machineEnvironment,
    timeoutMs: 120_000,
    privateValues,
  });
  const archivedDiff = archivedDiffRun.result.value.view;
  assert.equal(archivedDiff.currentness, "exact");
  assert.equal(archivedDiff.candidate.digest, integratedCandidate.digest);
  assert.equal(archivedDiff.seal.digest, seals[0].digest);
  assert.equal(archivedDiff.tree, acceptedTree);
  assert.equal(archivedDiff.exactDiffDigest, candidateDiff.exactDiffDigest);
  assert.equal(archivedDiff.content, candidateDiff.content);

  const reclamation = await assertExecutionCellsReclaimed({
    environment,
    storeId: terminalDelivery.storeId,
    processId: terminalDelivery.processId,
    expectedCount: 7,
  });
  assert.equal(reclamation.summary.obligationSetDigest,
    closure.payload.reclamationHandoff.obligationSetDigest);

  const recoveryInvocationCount = [
    preparationRuns,
    admittedOperation.runs,
    continuedOperation.runs,
    contextIntegrationOperation.runs,
    reaffirmedOperation.runs,
    readmittedOperation.runs,
    integratedOperation.runs,
    evaluatedOperation.runs,
    acceptedOperation.runs,
  ].reduce((count, runs) => count + runs.length - 1, 0);

  assertNoPrivateOutput([
    versionRun.stdout,
    initializeRun.stdout,
    validateRun.stdout,
    ...preparationRuns.map(({ stdout }) => stdout),
    statusRun.stdout,
    eventsRun.stdout,
    attemptRun.stdout,
    boundaryRun.stdout,
    evidenceRun.stdout,
    ...admittedOperation.runs.map(({ stdout }) => stdout),
    admittedViewRun.stdout,
    ...continuedOperation.runs.map(({ stdout }) => stdout),
    candidateDiffRun.stdout,
    continuedViewRun.stdout,
    ...contextIntegrationOperation.runs.map(({ stdout }) => stdout),
    frozenRun.run.stdout,
    assessmentRun.run.stdout,
    conditionRun.run.stdout,
    frozenViewRun.stdout,
    ...reaffirmedOperation.runs.map(({ stdout }) => stdout),
    successorBoundaryRun.run.stdout,
    ...readmittedOperation.runs.map(({ stdout }) => stdout),
    reboundRun.run.stdout,
    readmittedViewRun.stdout,
    ...integratedOperation.runs.map(({ stdout }) => stdout),
    finalAssessmentRun.run.stdout,
    integratedViewRun.stdout,
    ...evaluatedOperation.runs.map(({ stdout }) => stdout),
    ...acceptedOperation.runs.map(({ stdout }) => stdout),
    terminalStatusRun.stdout,
    terminalEventsRun.stdout,
    terminalAttemptRun.stdout,
    terminalCandidateRun.stdout,
    candidateRevisionsRun.stdout,
    terminalEvidenceRun.stdout,
    terminalDecisionRun.stdout,
    terminalClosureRun.stdout,
    archivedDiffRun.stdout,
  ].join(""), privateValues, "Docker Agent public results");

  qualificationCleanupVerified = true;
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    qualification: "foundation-rc16-docker-agent-resolution-terminal-delivery",
    evidenceClass: "live-docker-execution-cell-terminal-row",
    sourceRevision,
    runtimeVersion: version.runtimeVersion,
    runtimeProtocol: version.runtimeProtocol,
    interfaceProtocol: prepared.interfaceProtocol,
    specificationRevision: version.specificationRevision,
    publicationDigest: version.publicationDigest,
    repositoryContract: contract.$schema,
    repositoryContractDigest: validateRun.result.observation.repository.repositoryContractDigest,
    controlStore: "lifecycle.control-record-store.v2",
    provider: {
      descriptorId: receipt.payload.provider.descriptorId,
      descriptorDigest: receipt.payload.provider.descriptorDigest,
      protocol: receipt.payload.provider.adapter,
      codexVersion: selection.codexVersion,
      executableIdentity: receipt.payload.provider.observedExecutableIdentity,
    },
    execution: {
      backendProfile: receipt.payload.execution.backendProfile,
      image: receipt.payload.execution.image,
      cellCount: 7,
      agentCellCount: executionReceipts.length,
      checkCellCount: checkReceipts.length,
      agentInputSetDigests: executionReceipts.map(({ payload }) => payload.execution.inputSet.digest),
      agentObservationDigests: executionReceipts.map(({ payload }) =>
        payload.execution.observationDigest),
      checkObservationDigests: checkReceipts.map(({ payload }) =>
        payload.execution.observationDigest),
      finalCheckReceiptDigest: finalCheckReceipt.digest,
      reclamationObligationSetDigest: reclamation.summary.obligationSetDigest,
      reclaimedCount: reclamation.summary.reclaimedCount,
      reclamationInvocationCount: reclamation.invocations,
      reclamationVerification: "automatic-installed-operation",
    },
    model: selection.model,
    reasoning: selection.reasoning,
    deliveryStanding: terminalDelivery.standing,
    journalEventCount: terminalDelivery.journal.eventCount,
    journalHeadDigest: terminalDelivery.journal.headDigest,
    storeDisposition: terminalDelivery.storeDisposition.stage,
    archiveManifestDigest: terminalDelivery.storeDisposition.archiveManifestDigest,
    agentAttemptDigests: agentAttempts.map(({ digest }) => digest),
    agentWorkProductDigests: workProducts.map(({ digest }) => digest),
    executionReceiptDigests: executionReceipts.map(({ digest }) => digest),
    workBoundaryDigests: [boundary.digest, successorBoundary.digest],
    resolution: {
      materialConditionDigest: materialCondition.digest,
      assessmentDigest: contextAssessment.digest,
      frozenCandidateDigest: frozenCandidate.digest,
      reconnaissanceAttemptDigest: resolutionAttempt.digest,
      readmissionCandidateDigest: reboundCandidate.digest,
      baselineCheckDigest: successorBaseline.digest,
    },
    candidateRevisionDigests: candidateRecords.map(({ digest }) => digest),
    integrationAssessmentDigest: integrationAssessment.digest,
    candidateSealDigest: seals[0].digest,
    checkReceiptDigests: checkReceipts.map(({ digest }) => digest),
    evidencePacketDigest: packets[0].digest,
    closureDigest: closure.digest,
    canonicalResult: {
      admittedBaseCommit: canonicalHead,
      parentCommit: canonicalParent,
      commit: acceptedHead,
      tree: acceptedTree,
      diffDigest: archivedDiff.exactDiffDigest,
    },
    boundaries: {
      packedInstallationEvidence: false,
      productiveCandidateEvidence: true,
      frozenCandidateResolutionEvidence: true,
      terminalTransactionEvidence: true,
      archivedStoreReadEvidence: true,
      exactReclamationEvidence: true,
      parentLossOrRecoveryEvidence: recoveryInvocationCount > 0,
      portabilityEvidence: false,
      publicationOrConformanceClaim: false,
    },
    recoveryInvocationCount,
  }, null, 2)}\n`);
} finally {
  if (!qualificationCustodyAllocated || qualificationCleanupVerified) {
    await rm(owner, { recursive: true, force: true });
    await rm(join(machineHome, "authorities", targetId), { recursive: true, force: true });
    for (const area of ["active", "archive", "staging"]) {
      await rm(join(registryRoot, area, targetRegistrySegment), { recursive: true, force: true });
    }
  }
}
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === SCRIPT) {
  await main();
}
