import { FoundationError } from "../foundation/error.js";
import type {
  ExecutionReceiptProviderObservation,
} from "../foundation/control/execution-receipt.js";
import type {
  FoundationExecutionDeclaredOutputRootV1,
  FoundationExecutionSpecificationV1,
} from "../foundation/execution/contracts.js";
import type {
  FoundationExecutionOutputEntryReaderV1,
  FoundationRetrievedExecutionOutputV1,
} from "../foundation/execution/backend.js";
import type {
  FoundationValidatedCandidateOutputV1,
  FoundationValidatedExecutionOutputArtifactV1,
  FoundationValidatedExecutionOutputV1,
} from "../foundation/execution/output-validation.js";
import {
  canonicalJsonLine,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../foundation/validation/canonical.js";

const MAXIMUM_PROVIDER_RESULT_BYTES = 64 * 1024;
const MAXIMUM_PROVIDER_FAILURE_BYTES = 16 * 1024;
const CANONICAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SIGNAL = /^SIG[A-Z0-9]+$/u;

export const FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1 = Object.freeze({
  runnerContractId: "lifecycle.execution-cell-runner.v1" as const,
  providerTerminalObservationPath: "provider-terminal/observation.json" as const,
  providerTerminalObservationMediaType: "application/json" as const,
  providerResultPath: "provider-result/result.json" as const,
  providerResultMediaType: "application/json" as const,
  providerFailureDiagnosticPath: "provider-result/failure.json" as const,
  providerFailureDiagnosticMediaType: "application/json" as const,
  semanticWorkspacePath: "agent-work-product/semantic.md" as const,
  semanticWorkspaceMediaType: "text/markdown; charset=utf-8" as const,
});

export type FoundationAgentExecutionCellRoleV1 =
  | "reconnaissance"
  | "builder"
  | "reviewer";

export type FoundationAgentExecutionCellOutputContractLimitsV1 = Readonly<{
  outputEntries: number;
  outputBytes: number;
  outputEntryBytes: number;
}>;

export type FoundationAgentExecutionCellSemanticSelectionV1 =
  | Readonly<{ disposition: "not-produced"; artifact: null }>
  | Readonly<{
      disposition: "available" | "invalid";
      artifact: FoundationValidatedExecutionOutputArtifactV1 | null;
    }>;

export type FoundationAgentExecutionCellCandidateSelectionV1 =
  | Readonly<{ disposition: "not-applicable"; output: null }>
  | Readonly<{
      disposition: "available" | "invalid";
      output: FoundationValidatedCandidateOutputV1 | null;
    }>;

export type FoundationAgentExecutionCellOwnedOutputV1 = Readonly<{
  providerTerminalObservation: FoundationValidatedExecutionOutputArtifactV1;
  providerResult: FoundationValidatedExecutionOutputArtifactV1 | null;
  providerFailureDiagnostic: FoundationValidatedExecutionOutputArtifactV1 | null;
  semantic: FoundationAgentExecutionCellSemanticSelectionV1;
  candidate: FoundationAgentExecutionCellCandidateSelectionV1;
}>;

export type FoundationAgentExecutionCellSemanticWorkspaceV1 = Readonly<{
  bytes: Uint8Array;
  byteLength: number;
  digest: Sha256;
}>;

/** Exact provider/adapter result sufficient to supply Receipt provider facts. */
export type FoundationAgentExecutionCellProviderResultV1 = Readonly<{
  schema: "lifecycle.agent-execution-cell-provider-result.v1";
  attemptDigest: Sha256;
  specificationDigest: Sha256;
  providerDescriptorDigest: Sha256;
  adapterImplementationDigest: Sha256;
  preparedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  executableIdentity: Sha256 | null;
  outcome: ExecutionReceiptProviderObservation["outcome"];
  stage: ExecutionReceiptProviderObservation["stage"];
  productiveStarted: boolean;
  firstTrigger: ExecutionReceiptProviderObservation["firstTrigger"];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  sessionId: string | null;
  digest: Sha256;
}>;

/**
 * Runner-owned terminal fact. Unlike raw Provider Result bytes, this artifact
 * is mandatory, installation-bound, and is the sole source of Receipt
 * Provider observation facts after dispatch.
 */
export type FoundationAgentExecutionCellProviderTerminalObservationV1 = Readonly<{
  schema: "lifecycle.agent-execution-cell-provider-terminal-observation.private.v1";
  attemptDigest: Sha256;
  specificationDigest: Sha256;
  providerDescriptorDigest: Sha256;
  adapterImplementationDigest: Sha256;
  imageDigest: Sha256;
  runnerContractDigest: Sha256;
  runnerImplementationDigest: Sha256;
  preparedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  executableIdentity: Sha256 | null;
  outcome: ExecutionReceiptProviderObservation["outcome"];
  stage: ExecutionReceiptProviderObservation["stage"];
  productiveStarted: boolean;
  firstTrigger: ExecutionReceiptProviderObservation["firstTrigger"];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  sessionId: string | null;
  digest: Sha256;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(
    `lifecycle.agent-execution-cell-operation-v1.${code}`,
    message,
  );
}

function positiveBound(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("limit", `${label} must be one positive safe integer`);
  }
  return value;
}

function exactTime(value: unknown, label: string): string {
  if (typeof value !== "string" || !CANONICAL_TIME.test(value) ||
      Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail("provider-result", `${label} must be one canonical UTC millisecond timestamp`);
  }
  return value;
}

function exactDigest(value: unknown, label: string): Sha256 {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail("provider-result", `${label} must be one exact SHA-256 digest`);
  }
  return value as Sha256;
}

function exactOptionalText(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    fail("provider-result", `${label} must be nonempty text or null`);
  }
  return value;
}

function exactInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 255) {
    fail("provider-result", `${label} must be one bounded nonnegative integer or null`);
  }
  return value as number;
}

/** Agent-owned roots beneath the shared Manifest contract. */
export function foundationAgentExecutionCellOutputContractV1(input: Readonly<{
  role: FoundationAgentExecutionCellRoleV1;
  limits: FoundationAgentExecutionCellOutputContractLimitsV1;
}>): Readonly<{
  manifestProfile: "lifecycle.execution-output-manifest.v1";
  declaredOutputRoots: readonly FoundationExecutionDeclaredOutputRootV1[];
  allowedModeClasses: readonly ["regular", "executable"];
  extraEntriesAllowed: false;
  digest: Sha256;
}> {
  const outputEntries = positiveBound(input.limits.outputEntries, "Output entry limit");
  const outputBytes = positiveBound(input.limits.outputBytes, "Output byte limit");
  const outputEntryBytes = positiveBound(
    input.limits.outputEntryBytes,
    "Output entry-byte limit",
  );
  if (outputEntryBytes > outputBytes) {
    fail("limit", "Output entry-byte limit exceeds the aggregate output limit");
  }
  if (input.role !== "reconnaissance" && input.role !== "builder" &&
      input.role !== "reviewer") {
    fail("role", "Agent Execution Cell role is unsupported");
  }
  const declaredOutputRoots: FoundationExecutionDeclaredOutputRootV1[] = [
    Object.freeze({
      path: "provider-terminal",
      purpose: "operational-artifact" as const,
      required: true,
      allowedModeClasses: Object.freeze(["regular"] as const),
      maximumEntries: 1,
      maximumBytes: Math.min(outputEntryBytes, MAXIMUM_PROVIDER_RESULT_BYTES),
    }),
    Object.freeze({
      path: "provider-result",
      purpose: "raw-provider-output" as const,
      required: false,
      allowedModeClasses: Object.freeze(["regular"] as const),
      maximumEntries: 2,
      maximumBytes: Math.min(outputEntryBytes, MAXIMUM_PROVIDER_RESULT_BYTES),
    }),
    Object.freeze({
      path: "agent-work-product",
      purpose: "agent-work-product" as const,
      required: false,
      allowedModeClasses: Object.freeze(["regular"] as const),
      maximumEntries: 1,
      maximumBytes: outputEntryBytes,
    }),
  ];
  if (input.role === "builder") {
    declaredOutputRoots.push(Object.freeze({
      path: "candidate-output",
      purpose: "candidate-output" as const,
      required: false,
      allowedModeClasses: Object.freeze(["regular", "executable"] as const),
      maximumEntries: outputEntries,
      maximumBytes: outputBytes,
    }));
  }
  declaredOutputRoots.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const subject = Object.freeze({
    manifestProfile: "lifecycle.execution-output-manifest.v1" as const,
    declaredOutputRoots: Object.freeze(declaredOutputRoots),
    allowedModeClasses: Object.freeze(["regular", "executable"] as const),
    extraEntriesAllowed: false as const,
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

/** Select semantic and Candidate branches independently after generic validation. */
export function inspectFoundationAgentExecutionCellOutputV1(input: Readonly<{
  role: FoundationAgentExecutionCellRoleV1;
  output: FoundationValidatedExecutionOutputV1;
}>): FoundationAgentExecutionCellOwnedOutputV1 {
  const provider = input.output.artifacts.filter(({ purpose }) => purpose === "raw-provider-output");
  const terminal = input.output.artifacts.filter(({ purpose }) => purpose === "operational-artifact");
  const semantic = input.output.artifacts.filter(({ purpose }) => purpose === "agent-work-product");
  const candidates = input.output.artifacts.filter(({ purpose }) => purpose === "candidate-output");
  if (input.output.artifacts.some(({ purpose }) =>
    purpose !== "raw-provider-output" && purpose !== "agent-work-product" &&
    purpose !== "candidate-output" && purpose !== "operational-artifact")) {
    fail("output-layout", "Agent output contains an artifact outside its owned roots");
  }

  const providerTerminalObservation = terminal.length === 1 ? terminal[0]! : null;
  if (providerTerminalObservation === null ||
      providerTerminalObservation.path !==
        FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationPath ||
      providerTerminalObservation.mediaType !==
        FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationMediaType ||
      providerTerminalObservation.modeClass !== "regular" ||
      providerTerminalObservation.candidateRepositoryPath !== null ||
      providerTerminalObservation.candidateGitMode !== null) {
    fail(
      "provider-terminal-observation",
      "Agent output lacks its exact runner-owned Provider terminal observation",
    );
  }

  const providerResult = provider.find(({ path }) =>
    path === FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerResultPath) ?? null;
  const providerFailureDiagnostic = provider.find(({ path }) =>
    path === FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerFailureDiagnosticPath) ?? null;
  if (providerResult !== null &&
      providerResult.path !== FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerResultPath ||
      providerResult !== null && providerResult.mediaType !==
        FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerResultMediaType ||
      providerResult !== null && providerResult.modeClass !== "regular" ||
      providerResult !== null && providerResult.candidateRepositoryPath !== null ||
      providerResult !== null && providerResult.candidateGitMode !== null ||
      provider.length !== Number(providerResult !== null) + Number(providerFailureDiagnostic !== null)) {
    fail("provider-result", "Agent output lacks its exact normalized provider result member");
  }

  const semanticArtifact = semantic.length === 1 ? semantic[0]! : null;
  const semanticSelection: FoundationAgentExecutionCellSemanticSelectionV1 =
    semantic.length === 0
      ? Object.freeze({ disposition: "not-produced" as const, artifact: null })
      : semanticArtifact !== null &&
          semanticArtifact.path ===
            FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.semanticWorkspacePath &&
          semanticArtifact.mediaType ===
            FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.semanticWorkspaceMediaType &&
          semanticArtifact.modeClass === "regular" &&
          semanticArtifact.candidateRepositoryPath === null &&
          semanticArtifact.candidateGitMode === null
        ? Object.freeze({ disposition: "available" as const, artifact: semanticArtifact })
        : Object.freeze({ disposition: "invalid" as const, artifact: null });

  let candidateSelection: FoundationAgentExecutionCellCandidateSelectionV1;
  if (input.role === "builder") {
    const available = input.output.candidateOutput !== null && candidates.length > 0 &&
      input.output.candidateOutput.entries.length === candidates.length &&
      input.output.candidateOutput.declaredRootPath === "candidate-output";
    candidateSelection = available
      ? Object.freeze({ disposition: "available" as const, output: input.output.candidateOutput })
      : Object.freeze({ disposition: "invalid" as const, output: null });
  } else {
    candidateSelection = input.output.candidateOutput === null && candidates.length === 0
      ? Object.freeze({ disposition: "not-applicable" as const, output: null })
      : Object.freeze({ disposition: "invalid" as const, output: null });
  }
  return Object.freeze({
    providerTerminalObservation,
    providerResult,
    providerFailureDiagnostic,
    semantic: semanticSelection,
    candidate: candidateSelection,
  });
}

/**
 * Observe only the fixed runner-owned Provider terminal member from one
 * contained Carrier. Unrelated authoring entries are not opened or validated;
 * whole-Carrier validation remains the execution host's separate next step.
 */
export async function observeFoundationAgentProviderTerminalCompletionV1(input: Readonly<{
  output: FoundationRetrievedExecutionOutputV1;
  specification: FoundationExecutionSpecificationV1;
  expectedManifestDigest: Sha256;
  attemptDigest: Sha256;
  executableIdentity: Sha256;
  runnerImplementationDigest: Sha256;
}>): Promise<FoundationAgentExecutionCellProviderTerminalObservationV1> {
  const manifest = input.output.manifest;
  const manifestKeys = [
    "aggregateByteLength", "completedAt", "digest", "entries", "entryCount",
    "entryInventoryDigest", "imageDigest", "inputSetDigest", "outputContractDigest",
    "runnerDigest", "schema", "specificationDigest",
  ].sort();
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest) ||
      Object.getOwnPropertySymbols(manifest).length !== 0 ||
      Object.getOwnPropertyNames(manifest).sort().join("\u0000") !== manifestKeys.join("\u0000") ||
      manifest.schema !== "lifecycle.execution-output-manifest.v1" ||
      manifest.digest !== selfDigest(manifest) ||
      manifest.digest !== input.expectedManifestDigest ||
      manifest.specificationDigest !== input.specification.digest ||
      manifest.inputSetDigest !== input.specification.inputSet.digest ||
      manifest.imageDigest !== input.specification.image.imageDigest ||
      manifest.outputContractDigest !== input.specification.outputContract.digest ||
      manifest.runnerDigest !== input.specification.runner.contractDigest ||
      !Array.isArray(manifest.entries)) {
    fail(
      "provider-terminal-observation",
      "Provider terminal completion lacks its exact Execution Manifest binding",
    );
  }
  const selectedEntries = manifest.entries.filter((entry) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry) &&
    entry.path === FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationPath);
  const declared = selectedEntries.length === 1 ? selectedEntries[0]! : null;
  if (declared === null || declared.entryKind !== "file" ||
      declared.purpose !== "operational-artifact" ||
      declared.mediaType !==
        FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationMediaType ||
      declared.modeClass !== "regular" || !Number.isSafeInteger(declared.byteLength) ||
      declared.byteLength < 1 || declared.byteLength > MAXIMUM_PROVIDER_RESULT_BYTES ||
      !SHA256.test(declared.digest)) {
    fail(
      "provider-terminal-observation",
      "Provider terminal completion lacks one exact declared operational artifact",
    );
  }
  let selected: FoundationExecutionOutputEntryReaderV1 | null = null;
  let readers: AsyncIterable<FoundationExecutionOutputEntryReaderV1>;
  try {
    readers = input.output.entries();
  } catch (error) {
    throw error;
  }
  if (readers === null || typeof readers !== "object" ||
      typeof readers[Symbol.asyncIterator] !== "function") {
    fail(
      "provider-terminal-observation",
      "Provider terminal completion readers are unavailable",
    );
  }
  try {
    for await (const reader of readers) {
      if (reader === null || typeof reader !== "object" ||
          reader.path !== FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationPath) {
        continue;
      }
      if (selected !== null || Object.getOwnPropertySymbols(reader).length !== 0 ||
          Object.getOwnPropertyNames(reader).sort().join("\u0000") !==
            ["byteLength", "digest", "path", "read"].join("\u0000") ||
          reader.byteLength !== declared.byteLength || reader.digest !== declared.digest ||
          typeof reader.read !== "function") {
        fail(
          "provider-terminal-observation",
          "Provider terminal completion reader substituted its exact artifact",
        );
      }
      selected = reader;
    }
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    throw error;
  }
  if (selected === null) {
    fail(
      "provider-terminal-observation",
      "Provider terminal completion reader is absent",
    );
  }
  const terminalReader = selected;
  const artifact: FoundationValidatedExecutionOutputArtifactV1 = Object.freeze({
    ...declared,
    candidateRepositoryPath: null,
    candidateGitMode: null,
    async *read() {
      yield* terminalReader.read();
    },
  });
  try {
    return await readFoundationAgentProviderTerminalObservationV1({
      artifact,
      specification: input.specification,
      attemptDigest: input.attemptDigest,
      executableIdentity: input.executableIdentity,
      runnerImplementationDigest: input.runnerImplementationDigest,
    });
  } catch (error) {
    if (error instanceof FoundationError &&
        error.code === "lifecycle.agent-execution-cell-operation-v1.artifact-read") {
      fail(
        "provider-terminal-observation",
        "Provider terminal completion bytes violate their exact declared artifact",
      );
    }
    throw error;
  }
}

async function readExactArtifact(input: Readonly<{
  artifact: FoundationValidatedExecutionOutputArtifactV1;
  maximumBytes: number;
  label: string;
}>): Promise<FoundationAgentExecutionCellSemanticWorkspaceV1> {
  const maximumBytes = positiveBound(input.maximumBytes, `${input.label} byte limit`);
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let stream: AsyncIterable<Uint8Array>;
  try {
    stream = input.artifact.read();
  } catch {
    return fail("artifact-read-interrupted", `${input.label} bytes could not be reopened`);
  }
  if (stream === null || typeof stream !== "object" ||
      typeof stream[Symbol.asyncIterator] !== "function") {
    fail("artifact-read", `${input.label} does not expose one byte stream`);
  }
  for await (const raw of stream) {
    if (!(raw instanceof Uint8Array) || raw.byteLength === 0) {
      fail("artifact-read", `${input.label} yielded an invalid byte chunk`);
    }
    byteLength += raw.byteLength;
    if (!Number.isSafeInteger(byteLength) || byteLength > maximumBytes ||
        byteLength > input.artifact.byteLength) {
      fail("artifact-read", `${input.label} exceeded its exact byte bound`);
    }
    chunks.push(Uint8Array.from(raw));
  }
  if (byteLength !== input.artifact.byteLength) {
    fail("artifact-read", `${input.label} byte stream ended before its exact length`);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = sha256Bytes(bytes);
  if (digest !== input.artifact.digest) {
    fail("artifact-read", `${input.label} bytes differ from their retained digest`);
  }
  return Object.freeze({ bytes, byteLength, digest });
}

export async function readFoundationAgentSemanticWorkspaceV1(input: Readonly<{
  artifact: FoundationValidatedExecutionOutputArtifactV1;
  maximumBytes: number;
}>): Promise<FoundationAgentExecutionCellSemanticWorkspaceV1> {
  if (input.artifact.purpose !== "agent-work-product" ||
      input.artifact.path !== FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.semanticWorkspacePath) {
    fail("semantic-workspace", "Selected artifact is not the governed semantic workspace");
  }
  return await readExactArtifact({
    artifact: input.artifact,
    maximumBytes: input.maximumBytes,
    label: "Semantic workspace",
  });
}

/** Bounded untrusted provider failure detail; never terminal observation or semantics. */
export async function readFoundationAgentProviderFailureDiagnosticV1(input: Readonly<{
  artifact: FoundationValidatedExecutionOutputArtifactV1;
}>): Promise<Uint8Array> {
  if (input.artifact.purpose !== "raw-provider-output" ||
      input.artifact.path !== FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerFailureDiagnosticPath ||
      input.artifact.mediaType !== "application/json" || input.artifact.modeClass !== "regular" ||
      input.artifact.candidateRepositoryPath !== null || input.artifact.candidateGitMode !== null ||
      input.artifact.byteLength > MAXIMUM_PROVIDER_FAILURE_BYTES) {
    fail("provider-failure-diagnostic", "Selected artifact is not the bounded provider failure diagnostic");
  }
  const reopened = await readExactArtifact({ artifact: input.artifact,
    maximumBytes: MAXIMUM_PROVIDER_FAILURE_BYTES, label: "Provider failure diagnostic" });
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(reopened.bytes)); }
  catch { return fail("provider-failure-diagnostic", "Provider failure diagnostic is not UTF-8 JSON"); }
  const exactObject = (selected: unknown, keys: readonly string[]): selected is Record<string, unknown> =>
    selected !== null && typeof selected === "object" && !Array.isArray(selected) &&
    JSON.stringify(Object.keys(selected).sort()) === JSON.stringify([...keys].sort());
  if (!exactObject(value, ["schema", "source", "observation", "entries", "truncated"]) ||
      value.schema !== "lifecycle.agent-provider-failure-diagnostic.private.v1" ||
      value.source !== "provider-reported" || value.observation !== "untrusted-operational-material" ||
      typeof value.truncated !== "boolean" || !Array.isArray(value.entries) || value.entries.length > 8 ||
      value.entries.some((entry) => !exactObject(entry, ["stream", "eventType", "message"]) ||
        !((entry.stream === "stdout-json" && (entry.eventType === "error" || entry.eventType === "turn.failed")) ||
          (entry.stream === "stderr" && entry.eventType === "error-line")) ||
        typeof entry.message !== "string" || entry.message.length === 0 ||
        Buffer.byteLength(entry.message, "utf8") > 2048 || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(entry.message))) {
    fail("provider-failure-diagnostic", "Provider failure diagnostic differs from its closed bounded shape");
  }
  let canonical = false;
  try { canonical = Buffer.from(reopened.bytes).equals(Buffer.from(canonicalJsonLine(value))); }
  catch { /* Non-scalar JSON text is an invalid independent diagnostic. */ }
  if (!canonical) fail("provider-failure-diagnostic", "Provider failure diagnostic is not canonical JSON");
  return Uint8Array.from(reopened.bytes);
}

/** Parse the runner's canonical provider/adapter result for Receipt use. */
export async function readFoundationAgentProviderResultV1(input: Readonly<{
  artifact: FoundationValidatedExecutionOutputArtifactV1;
  specification: FoundationExecutionSpecificationV1;
  attemptDigest: Sha256;
  executableIdentity: Sha256;
}>): Promise<FoundationAgentExecutionCellProviderResultV1> {
  if (input.specification.operation.kind !== "agent-attempt" ||
      input.artifact.purpose !== "raw-provider-output" ||
      input.artifact.path !== FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerResultPath) {
    fail("provider-result", "Selected artifact is not the governed Agent provider result");
  }
  const reopened = await readExactArtifact({
    artifact: input.artifact,
    maximumBytes: MAXIMUM_PROVIDER_RESULT_BYTES,
    label: "Provider result",
  });
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(reopened.bytes).toString("utf8"));
  } catch {
    return fail("provider-result", "Provider result is not canonical JSON");
  }
  const expectedKeys = [
    "adapterImplementationDigest", "attemptDigest", "digest", "executableIdentity",
    "exitCode", "finishedAt", "firstTrigger", "outcome", "preparedAt",
    "productiveStarted", "providerDescriptorDigest", "schema", "sessionId", "signal",
    "specificationDigest", "stage", "startedAt",
  ].sort();
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\u0000") !== expectedKeys.join("\u0000")) {
    fail("provider-result", "Provider result is not one exact closed object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.schema !== "lifecycle.agent-execution-cell-provider-result.v1" ||
      raw.attemptDigest !== input.attemptDigest ||
      raw.specificationDigest !== input.specification.digest ||
      raw.providerDescriptorDigest !== input.specification.operation.providerDescriptorDigest ||
      raw.adapterImplementationDigest !== input.specification.operation.adapterImplementationDigest ||
      raw.executableIdentity !== input.executableIdentity) {
    fail("provider-result", "Provider result substituted its exact Attempt, provider, or adapter binding");
  }
  const outcomes = new Set([
    "natural-return", "invalid-result", "timeout", "cancelled", "forced-termination",
    "provider-failure", "capability-refusal", "security-stop", "runtime-failure",
  ]);
  const stages = new Set([
    "preflight", "compatibility", "dispatch", "running", "result-validation", "evaluated",
  ]);
  const triggers = new Set([
    "natural-return", "timeout", "cancellation", "force-cancellation", "safety-limit",
    "provider-failure", "capability-refusal", "security-stop", "runtime-failure",
    "invalid-result",
  ]);
  if (!outcomes.has(raw.outcome as string) || !stages.has(raw.stage as string) ||
      !triggers.has(raw.firstTrigger as string) || typeof raw.productiveStarted !== "boolean") {
    fail("provider-result", "Provider result carries an unsupported terminal classification");
  }
  const preparedAt = exactTime(raw.preparedAt, "Provider preparation time");
  const startedAt = raw.startedAt === null ? null : exactTime(raw.startedAt, "Provider start time");
  const finishedAt = raw.finishedAt === null ? null : exactTime(raw.finishedAt, "Provider finish time");
  if ((raw.productiveStarted && (startedAt === null || finishedAt === null)) ||
      (startedAt !== null && Date.parse(startedAt) < Date.parse(preparedAt)) ||
      (finishedAt !== null && Date.parse(finishedAt) < Date.parse(startedAt ?? preparedAt))) {
    fail("provider-result", "Provider result times contradict its productive-start classification");
  }
  const signal = raw.signal === null
    ? null
    : typeof raw.signal === "string" && SIGNAL.test(raw.signal)
      ? raw.signal as NodeJS.Signals
      : fail("provider-result", "Provider result signal is invalid");
  const subject = Object.freeze({
    schema: "lifecycle.agent-execution-cell-provider-result.v1" as const,
    attemptDigest: exactDigest(raw.attemptDigest, "Provider result Attempt digest"),
    specificationDigest: exactDigest(raw.specificationDigest, "Provider result Specification digest"),
    providerDescriptorDigest: exactDigest(raw.providerDescriptorDigest, "Provider descriptor digest"),
    adapterImplementationDigest: exactDigest(raw.adapterImplementationDigest, "Adapter digest"),
    preparedAt,
    startedAt,
    finishedAt,
    executableIdentity: raw.executableIdentity === null
      ? null
      : exactDigest(raw.executableIdentity, "Provider executable identity"),
    outcome: raw.outcome as ExecutionReceiptProviderObservation["outcome"],
    stage: raw.stage as ExecutionReceiptProviderObservation["stage"],
    productiveStarted: raw.productiveStarted,
    firstTrigger: raw.firstTrigger as ExecutionReceiptProviderObservation["firstTrigger"],
    exitCode: exactInteger(raw.exitCode, "Provider exit code"),
    signal,
    sessionId: exactOptionalText(raw.sessionId, "Provider session identity"),
  });
  if (raw.digest !== selfDigest(subject) ||
      Buffer.compare(Buffer.from(reopened.bytes), Buffer.from(canonicalJsonLine({
        ...subject,
        digest: raw.digest,
      }))) !== 0) {
    fail("provider-result", "Provider result digest or canonical bytes are invalid");
  }
  return Object.freeze({ ...subject, digest: raw.digest as Sha256 });
}

/** Parse the mandatory runner-owned terminal observation used for Receipt facts. */
export async function readFoundationAgentProviderTerminalObservationV1(input: Readonly<{
  artifact: FoundationValidatedExecutionOutputArtifactV1;
  specification: FoundationExecutionSpecificationV1;
  attemptDigest: Sha256;
  executableIdentity: Sha256;
  runnerImplementationDigest: Sha256;
}>): Promise<FoundationAgentExecutionCellProviderTerminalObservationV1> {
  if (input.specification.operation.kind !== "agent-attempt" ||
      input.artifact.purpose !== "operational-artifact" ||
      input.artifact.path !==
        FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationPath) {
    fail(
      "provider-terminal-observation",
      "Selected artifact is not the runner-owned Provider terminal observation",
    );
  }
  const reopened = await readExactArtifact({
    artifact: input.artifact,
    maximumBytes: MAXIMUM_PROVIDER_RESULT_BYTES,
    label: "Provider terminal observation",
  });
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(reopened.bytes).toString("utf8"));
  } catch {
    return fail(
      "provider-terminal-observation",
      "Provider terminal observation is not canonical JSON",
    );
  }
  const expectedKeys = [
    "adapterImplementationDigest", "attemptDigest", "digest", "executableIdentity",
    "exitCode", "finishedAt", "firstTrigger", "imageDigest", "outcome", "preparedAt",
    "productiveStarted", "providerDescriptorDigest", "runnerContractDigest",
    "runnerImplementationDigest", "schema", "sessionId", "signal",
    "specificationDigest", "stage", "startedAt",
  ].sort();
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\u0000") !== expectedKeys.join("\u0000")) {
    fail(
      "provider-terminal-observation",
      "Provider terminal observation is not one exact closed object",
    );
  }
  const raw = value as Record<string, unknown>;
  if (raw.schema !==
        "lifecycle.agent-execution-cell-provider-terminal-observation.private.v1" ||
      raw.attemptDigest !== input.attemptDigest ||
      raw.specificationDigest !== input.specification.digest ||
      raw.providerDescriptorDigest !== input.specification.operation.providerDescriptorDigest ||
      raw.adapterImplementationDigest !==
        input.specification.operation.adapterImplementationDigest ||
      raw.imageDigest !== input.specification.image.imageDigest ||
      raw.runnerContractDigest !== input.specification.runner.contractDigest ||
      raw.runnerImplementationDigest !== input.runnerImplementationDigest ||
      (raw.executableIdentity !== null && raw.executableIdentity !== input.executableIdentity)) {
    fail(
      "provider-terminal-observation",
      "Provider terminal observation substituted its exact runner, image, Attempt, provider, or adapter binding",
    );
  }
  const outcomes = new Set([
    "natural-return", "invalid-result", "timeout", "cancelled", "forced-termination",
    "provider-failure", "capability-refusal", "security-stop", "runtime-failure",
  ]);
  const stages = new Set([
    "preflight", "compatibility", "dispatch", "running", "result-validation", "evaluated",
  ]);
  const triggers = new Set([
    "natural-return", "timeout", "cancellation", "force-cancellation", "safety-limit",
    "provider-failure", "capability-refusal", "security-stop", "runtime-failure",
    "invalid-result",
  ]);
  if (!outcomes.has(raw.outcome as string) || !stages.has(raw.stage as string) ||
      !triggers.has(raw.firstTrigger as string) || typeof raw.productiveStarted !== "boolean") {
    fail(
      "provider-terminal-observation",
      "Provider terminal observation carries an unsupported terminal classification",
    );
  }
  const preparedAt = exactTime(raw.preparedAt, "Provider preparation time");
  const startedAt = raw.startedAt === null
    ? null
    : exactTime(raw.startedAt, "Provider start time");
  const finishedAt = exactTime(raw.finishedAt, "Provider finish time");
  if ((raw.productiveStarted && (startedAt === null || raw.executableIdentity === null)) ||
      (!raw.productiveStarted && startedAt !== null) ||
      (startedAt !== null && Date.parse(startedAt) < Date.parse(preparedAt)) ||
      Date.parse(finishedAt) < Date.parse(startedAt ?? preparedAt)) {
    fail(
      "provider-terminal-observation",
      "Provider terminal observation times contradict its productive-start classification",
    );
  }
  const signal = raw.signal === null
    ? null
    : typeof raw.signal === "string" && SIGNAL.test(raw.signal)
      ? raw.signal as NodeJS.Signals
      : fail("provider-terminal-observation", "Provider terminal observation signal is invalid");
  const subject = Object.freeze({
    schema: "lifecycle.agent-execution-cell-provider-terminal-observation.private.v1" as const,
    attemptDigest: exactDigest(raw.attemptDigest, "Provider terminal Attempt digest"),
    specificationDigest: exactDigest(
      raw.specificationDigest,
      "Provider terminal Specification digest",
    ),
    providerDescriptorDigest: exactDigest(
      raw.providerDescriptorDigest,
      "Provider terminal Descriptor digest",
    ),
    adapterImplementationDigest: exactDigest(
      raw.adapterImplementationDigest,
      "Provider terminal Adapter digest",
    ),
    imageDigest: exactDigest(raw.imageDigest, "Provider terminal Image digest"),
    runnerContractDigest: exactDigest(
      raw.runnerContractDigest,
      "Provider terminal runner contract digest",
    ),
    runnerImplementationDigest: exactDigest(
      raw.runnerImplementationDigest,
      "Provider terminal runner implementation digest",
    ),
    preparedAt,
    startedAt,
    finishedAt,
    executableIdentity: raw.executableIdentity === null
      ? null
      : exactDigest(raw.executableIdentity, "Provider terminal executable identity"),
    outcome: raw.outcome as ExecutionReceiptProviderObservation["outcome"],
    stage: raw.stage as ExecutionReceiptProviderObservation["stage"],
    productiveStarted: raw.productiveStarted,
    firstTrigger: raw.firstTrigger as ExecutionReceiptProviderObservation["firstTrigger"],
    exitCode: exactInteger(raw.exitCode, "Provider terminal exit code"),
    signal,
    sessionId: exactOptionalText(raw.sessionId, "Provider terminal session identity"),
  });
  if (raw.digest !== selfDigest(subject) ||
      Buffer.compare(Buffer.from(reopened.bytes), Buffer.from(canonicalJsonLine({
        ...subject,
        digest: raw.digest,
      }))) !== 0) {
    fail(
      "provider-terminal-observation",
      "Provider terminal observation digest or canonical bytes are invalid",
    );
  }
  return Object.freeze({ ...subject, digest: raw.digest as Sha256 });
}
