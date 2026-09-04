import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, normalize, parse, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createFoundationRuntimeOperationRequest,
  parseFoundationCliErrorJson,
  parseFoundationRuntimeOperationResultForRequest,
  parseFoundationRuntimeOperationResultJson,
  parseFoundationRuntimeVersionJson,
  type FoundationCliError,
  type FoundationAttemptViewSelection,
  type FoundationControlRecordKind,
  type FoundationDeliveryDiff,
  type FoundationDeliveryGeneration,
  type FoundationDeliveryInbox,
  type FoundationDeliveryView,
  type FoundationRuntimeOperationKind,
  type FoundationRuntimeOperationRequest,
  type FoundationRuntimeOperationResult,
  type FoundationRuntimeVersion,
  type FoundationSha256,
} from "@neutral/lifecycle-protocol";

export type { FoundationCliError, FoundationRuntimeVersion } from "@neutral/lifecycle-protocol";

const MAXIMUM_STDOUT_BYTES = 16 * 1024 * 1024;
const MAXIMUM_STDERR_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const TERMINATION_GRACE_MS = 7_000;
const MAXIMUM_LIFECYCLE_PATH_BYTES = 4_096;
const MAXIMUM_PROVIDER_SELECTION_CHARACTERS = 160;
const PROVIDER_SELECTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export type FoundationStatusResult = FoundationRuntimeOperationResult;
export type FoundationValidationResult = FoundationRuntimeOperationResult;
export type FoundationPrepareResult = FoundationRuntimeOperationResult;
export type FoundationAttemptViewResult = FoundationRuntimeOperationResult;
export type FoundationInboxOperationResult = FoundationRuntimeOperationResult;
export type FoundationDeliveryViewResult = FoundationRuntimeOperationResult;
export type FoundationControlInspectionResult = FoundationRuntimeOperationResult;
export type FoundationDiffOperationResult = FoundationRuntimeOperationResult;
export type FoundationWatchOperationResult = FoundationRuntimeOperationResult;
export type FoundationNextPassResult = FoundationRuntimeOperationResult;
export type { FoundationDeliveryDiff, FoundationDeliveryGeneration, FoundationDeliveryInbox, FoundationDeliveryView };

export type FoundationNextPassOperation =
  | "delivery.continue"
  | "delivery.evaluate"
  | "delivery.revise"
  | "delivery.reaffirm";

export type FoundationControlInspectionQuery =
  | Readonly<{ kind: "families" }>
  | Readonly<{
    kind: "family";
    recordKind: FoundationControlRecordKind;
    afterRecordId: string | null;
    limit: number;
  }>
  | Readonly<{
    kind: "revisions";
    recordId: string;
    afterRevision: number;
    limit: number;
  }>;

export type ResolvedLifecycleExecutable = Readonly<{
  requestedPath: string;
  physicalPath: string;
  version: FoundationRuntimeVersion;
}>;

export type LifecycleCliCancellation = Readonly<{
  signal?: AbortSignal;
  forceSignal?: AbortSignal;
  timeoutMs?: number;
}>;

export type LifecycleReadOptions = LifecycleCliCancellation;

export type LifecycleCliTransport = Readonly<{
  executable: ResolvedLifecycleExecutable;
  validate(target: string, options?: LifecycleReadOptions): Promise<FoundationValidationResult>;
  status(target: string, deliveryId: string, options?: LifecycleReadOptions): Promise<FoundationStatusResult>;
  inspectAttemptView(
    target: string,
    deliveryId: string,
    selection?: FoundationAttemptViewSelection,
    options?: LifecycleReadOptions,
  ): Promise<FoundationAttemptViewResult>;
  inbox(
    target: string,
    query?: Readonly<{ afterDeliveryId: string | null; limit: number }>,
    options?: LifecycleReadOptions,
  ): Promise<FoundationInboxOperationResult>;
  inspectDeliveryView(
    target: string,
    deliveryId: string,
    options?: LifecycleReadOptions,
  ): Promise<FoundationDeliveryViewResult>;
  inspectControl(
    target: string,
    deliveryId: string,
    query: FoundationControlInspectionQuery,
    options?: LifecycleReadOptions,
  ): Promise<FoundationControlInspectionResult>;
  diff(
    target: string,
    deliveryId: string,
    query: Readonly<{ subject: "candidate" | "decision"; maximumBytes: number }>,
    options?: LifecycleReadOptions,
  ): Promise<FoundationDiffOperationResult>;
  watch(
    target: string,
    query: Readonly<{
      scope: "inbox" | "delivery";
      deliveryId: string | null;
      afterGeneration: string | null;
      timeoutMs: number;
    }>,
    options?: LifecycleReadOptions,
  ): Promise<FoundationWatchOperationResult>;
  prepare(target: string, semanticMarkdown: string, options?: LifecycleReadOptions): Promise<FoundationPrepareResult>;
  executeNextPass(
    target: string,
    deliveryId: string,
    operation: FoundationNextPassOperation,
    semanticMarkdown: string,
    expectedGeneration: string,
    options?: LifecycleReadOptions,
  ): Promise<FoundationNextPassResult>;
}>;

export class FoundationTuiTransportError extends Error {
  readonly code: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;

  constructor(
    code: string,
    message: string,
    details: Readonly<{ exitCode?: number | null; signal?: NodeJS.Signals | null }> = {},
  ) {
    super(message);
    this.name = "FoundationTuiTransportError";
    this.code = code;
    this.exitCode = details.exitCode ?? null;
    this.signal = details.signal ?? null;
  }
}

export class FoundationCliReportedError extends FoundationTuiTransportError {
  readonly failure: FoundationCliError;

  constructor(failure: FoundationCliError, exitCode: number | null, signal: NodeJS.Signals | null) {
    super("tui.cli.reported-error", failure.message, { exitCode, signal });
    this.name = "FoundationCliReportedError";
    this.failure = failure;
  }
}

function transportFailure(
  code: string,
  message: string,
  details?: Readonly<{ exitCode?: number | null; signal?: NodeJS.Signals | null }>,
): never {
  throw new FoundationTuiTransportError(code, message, details);
}

type LifecycleInvocationBoundary = Readonly<{
  signal?: AbortSignal;
  forceSignal?: AbortSignal;
  deadlineAt: number;
}>;

function invocationBoundary(cancellation: LifecycleCliCancellation): LifecycleInvocationBoundary {
  const timeoutMs = cancellation.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 24 * 60 * 60 * 1000) {
    throw new TypeError("timeoutMs must be a positive safe integer no greater than one day");
  }
  return Object.freeze({
    signal: cancellation.signal,
    forceSignal: cancellation.forceSignal,
    deadlineAt: performance.now() + timeoutMs,
  });
}

function boundaryError(
  boundary: LifecycleInvocationBoundary,
  details: Readonly<{ exitCode?: number | null; signal?: NodeJS.Signals | null }> = {},
): FoundationTuiTransportError | null {
  if (boundary.signal?.aborted || boundary.forceSignal?.aborted) {
    return new FoundationTuiTransportError("tui.cli.cancelled", "Lifecycle invocation was cancelled", details);
  }
  if (performance.now() >= boundary.deadlineAt) {
    return new FoundationTuiTransportError(
      "tui.cli.timeout",
      "Lifecycle invocation exceeded its wall-time bound",
      details,
    );
  }
  return null;
}

function assertBoundaryActive(boundary: LifecycleInvocationBoundary): void {
  const failure = boundaryError(boundary);
  if (failure !== null) throw failure;
}

function fallbackPath(): string {
  const paths = [dirname(process.execPath)];
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    if (systemRoot !== undefined) paths.push(resolve(systemRoot, "System32"));
  } else {
    paths.push("/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin");
  }
  return [...new Set(paths)].join(delimiter);
}

function exactDeliveryId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) transportFailure("tui.cli.delivery-id", "A Delivery read requires one exact v10 Delivery identity");
  return value;
}

function exactGeneration(value: string): FoundationSha256 {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    transportFailure("tui.cli.delivery-generation", "A Delivery mutation requires one exact runtime generation digest");
  }
  return value as FoundationSha256;
}

/** Resolve the explicit CLI locator, or the exact installed `lifecycle` name on PATH. */
export async function resolveLifecycleExecutablePath(
  selected: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (selected.length === 0 || selected.includes("\u0000")) {
    throw new TypeError("Lifecycle executable path must be nonempty");
  }
  if (selected.includes("/") || selected.includes("\\")) return resolve(selected);
  const supportedBareName = selected === "lifecycle" ||
    (process.platform === "win32" && selected === "lifecycle.exe");
  if (!supportedBareName) {
    throw new TypeError("A bare Lifecycle executable selection must be exactly lifecycle (or lifecycle.exe on Windows)");
  }
  const installedName = process.platform === "win32" && selected === "lifecycle"
    ? "lifecycle.exe"
    : selected;
  const searchPath = environment.PATH ?? fallbackPath();
  for (const entry of searchPath.split(delimiter)) {
    if (entry.length === 0 || entry.includes("\u0000")) continue;
    const candidate = join(resolve(entry), installedName);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the caller's ordinary installed-command search path.
    }
  }
  transportFailure("tui.cli.executable-unavailable", "The Lifecycle executable is unavailable on the selected PATH");
}

/** Retain only ordinary process context; no Lifecycle custody enters this base. */
export function sanitizedLifecycleEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = { PATH: source.PATH ?? fallbackPath() };
  for (const name of [
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "NO_COLOR",
  ] as const) {
    const value = source[name];
    if (value !== undefined && !value.includes("\u0000")) output[name] = value;
  }
  return output;
}

function exactLifecyclePathEnvironmentValue(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAXIMUM_LIFECYCLE_PATH_BYTES &&
    isAbsolute(value) && normalize(value) === value && value !== parse(value).root &&
    !value.endsWith(sep) && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function exactProviderSelectionEnvironmentValue(value: string | undefined): value is string {
  return value !== undefined && value.length <= MAXIMUM_PROVIDER_SELECTION_CHARACTERS &&
    PROVIDER_SELECTION_PATTERN.test(value);
}

function exactInstalledDigestEnvironmentValue(value: string | undefined): value is string {
  return value !== undefined && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function exactDockerEndpointEnvironmentValue(value: string | undefined): value is string {
  return value !== undefined && Buffer.byteLength(value, "utf8") <= MAXIMUM_LIFECYCLE_PATH_BYTES &&
    /^unix:\/\/\/[^\u0000\r\n]+$/u.test(value);
}

function exactExecutionArchitectureEnvironmentValue(value: string | undefined): value is string {
  return value === "amd64" || value === "arm64";
}

function exactCodexVersionEnvironmentValue(value: string | undefined): value is string {
  return value !== undefined && /^\d+\.\d+\.\d+$/u.test(value);
}

/** Add only the bounded machine-home coordinate needed by Delivery reads. */
export function sanitizedLifecycleDeliveryEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const output = sanitizedLifecycleEnvironment(source);
  const machineHome = source.LIFECYCLE_MACHINE_HOME;
  if (exactLifecyclePathEnvironmentValue(machineHome)) {
    output.LIFECYCLE_MACHINE_HOME = machineHome;
  }
  return output;
}

/** Add the complete bounded installed coordinates needed by productive operations. */
export function sanitizedLifecyclePrepareEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const output = sanitizedLifecycleDeliveryEnvironment(source);
  for (const name of [
    "LIFECYCLE_FOUNDATION_PROVIDER_MODEL",
    "LIFECYCLE_FOUNDATION_PROVIDER_REASONING",
  ] as const) {
    const value = source[name];
    if (exactProviderSelectionEnvironmentValue(value)) output[name] = value;
  }
  for (const name of [
    "LIFECYCLE_DOCKER_PATH",
    "LIFECYCLE_DOCKER_CONFIG",
  ] as const) {
    const value = source[name];
    if (exactLifecyclePathEnvironmentValue(value)) output[name] = value;
  }
  const dockerHost = source.LIFECYCLE_DOCKER_HOST;
  if (exactDockerEndpointEnvironmentValue(dockerHost)) {
    output.LIFECYCLE_DOCKER_HOST = dockerHost;
  }
  const imageId = source.LIFECYCLE_EXECUTION_IMAGE_ID;
  if (exactProviderSelectionEnvironmentValue(imageId)) {
    output.LIFECYCLE_EXECUTION_IMAGE_ID = imageId;
  }
  for (const name of [
    "LIFECYCLE_EXECUTION_IMAGE_DIGEST",
    "LIFECYCLE_EXECUTION_RUNNER_CONTRACT_DIGEST",
    "LIFECYCLE_EXECUTION_RUNNER_IMPLEMENTATION_DIGEST",
    "LIFECYCLE_EXECUTION_TOOL_INVENTORY_DIGEST",
    "LIFECYCLE_EXECUTION_CODEX_EXECUTABLE_IDENTITY",
    "LIFECYCLE_EXECUTION_AGENT_ADAPTER_IMPLEMENTATION_DIGEST",
  ] as const) {
    const value = source[name];
    if (exactInstalledDigestEnvironmentValue(value)) output[name] = value;
  }
  const architecture = source.LIFECYCLE_EXECUTION_IMAGE_ARCHITECTURE;
  if (exactExecutionArchitectureEnvironmentValue(architecture)) {
    output.LIFECYCLE_EXECUTION_IMAGE_ARCHITECTURE = architecture;
  }
  const codexVersion = source.LIFECYCLE_EXECUTION_CODEX_VERSION;
  if (exactCodexVersionEnvironmentValue(codexVersion)) {
    output.LIFECYCLE_EXECUTION_CODEX_VERSION = codexVersion;
  }
  return output;
}

type CommandOutput = Readonly<{
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}>;

function signalProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The direct handle remains a safe fallback if the group already exited.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The child may already have exited.
  }
}

async function invokeWithinBoundary(
  executable: Pick<ResolvedLifecycleExecutable, "physicalPath">,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  boundary: LifecycleInvocationBoundary,
): Promise<CommandOutput> {
  assertBoundaryActive(boundary);
  const output = await new Promise<CommandOutput>((resolveOutput, rejectOutput) => {
    assertBoundaryActive(boundary);
    const child = spawn(executable.physicalPath, [...args], {
      cwd: dirname(executable.physicalPath),
      detached: process.platform !== "win32",
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow: "stdout" | "stderr" | null = null;
    let cancelled = false;
    let timedOut = false;
    let settled = false;
    let hardStop: NodeJS.Timeout | undefined;
    const remainingMs = Math.max(1, Math.ceil(boundary.deadlineAt - performance.now()));
    const timeout = setTimeout(() => {
      timedOut = true;
      signalProcessGroup(child, "SIGINT");
      hardStop ??= setTimeout(() => signalProcessGroup(child, "SIGKILL"), TERMINATION_GRACE_MS);
      hardStop.unref();
    }, remainingMs);
    timeout.unref();

    const gracefulAbort = (): void => {
      cancelled = true;
      signalProcessGroup(child, "SIGINT");
      hardStop ??= setTimeout(() => signalProcessGroup(child, "SIGKILL"), TERMINATION_GRACE_MS);
      hardStop.unref();
    };
    const forceAbort = (): void => {
      cancelled = true;
      signalProcessGroup(child, "SIGKILL");
    };
    boundary.signal?.addEventListener("abort", gracefulAbort, { once: true });
    boundary.forceSignal?.addEventListener("abort", forceAbort, { once: true });
    if (boundary.signal?.aborted) gracefulAbort();
    if (boundary.forceSignal?.aborted) forceAbort();

    const retain = (
      stream: "stdout" | "stderr",
      chunk: Buffer,
      maximum: number,
      buffers: Buffer[],
      current: number,
    ): number => {
      const remaining = Math.max(0, maximum - current);
      if (remaining > 0) buffers.push(Buffer.from(chunk.subarray(0, remaining)));
      const next = current + Math.min(chunk.byteLength, remaining);
      if (chunk.byteLength > remaining && overflow === null) {
        overflow = stream;
        signalProcessGroup(child, "SIGINT");
        hardStop ??= setTimeout(() => signalProcessGroup(child, "SIGKILL"), TERMINATION_GRACE_MS);
        hardStop.unref();
      }
      return next;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes = retain("stdout", chunk, MAXIMUM_STDOUT_BYTES, stdout, stdoutBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes = retain("stderr", chunk, MAXIMUM_STDERR_BYTES, stderr, stderrBytes);
    });

    const cleanup = (): void => {
      clearTimeout(timeout);
      if (hardStop !== undefined) clearTimeout(hardStop);
      boundary.signal?.removeEventListener("abort", gracefulAbort);
      boundary.forceSignal?.removeEventListener("abort", forceAbort);
    };
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const authoritativeFailure = timedOut
        ? new FoundationTuiTransportError("tui.cli.timeout", "Lifecycle invocation exceeded its wall-time bound")
        : boundaryError(boundary);
      if (cancelled || authoritativeFailure !== null) {
        rejectOutput(authoritativeFailure ?? new FoundationTuiTransportError(
          "tui.cli.cancelled",
          "Lifecycle invocation was cancelled",
        ));
        return;
      }
      rejectOutput(new FoundationTuiTransportError(
        "tui.cli.spawn",
        `Lifecycle executable could not be started: ${error.message}`,
      ));
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const authoritativeFailure = timedOut
        ? new FoundationTuiTransportError(
          "tui.cli.timeout",
          "Lifecycle invocation exceeded its wall-time bound",
          { exitCode, signal },
        )
        : boundaryError(boundary, { exitCode, signal });
      if (cancelled || authoritativeFailure !== null) {
        rejectOutput(authoritativeFailure ?? new FoundationTuiTransportError(
          "tui.cli.cancelled",
          "Lifecycle invocation was cancelled",
          { exitCode, signal },
        ));
        return;
      }
      if (overflow !== null) {
        rejectOutput(new FoundationTuiTransportError(
          `tui.cli.${overflow}-limit`,
          `Lifecycle ${overflow} exceeded the presentation byte bound`,
          { exitCode, signal },
        ));
        return;
      }
      resolveOutput(Object.freeze({
        stdout: Buffer.concat(stdout, stdoutBytes),
        stderr: Buffer.concat(stderr, stderrBytes),
        exitCode,
        signal,
      }));
    });
  });
  assertBoundaryActive(boundary);
  return output;
}

function exactTarget(value: string): string {
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    value.includes("\u0000") ||
    !isAbsolute(value) ||
    resolve(value) !== value
  ) {
    throw new TypeError("Lifecycle target must be one normalized absolute path");
  }
  return value;
}

function parseSuccessfulOutput(
  output: CommandOutput,
  options: Readonly<{ allowReportedEffects: boolean }> = { allowReportedEffects: false },
): FoundationRuntimeOperationResult {
  if (output.exitCode !== 0 || output.signal !== null) {
    if (output.stdout.byteLength !== 0) {
      transportFailure("tui.cli.mixed-output", "Failed Lifecycle invocation produced unsupported stdout", {
        exitCode: output.exitCode,
        signal: output.signal,
      });
    }
    if (output.stderr.byteLength === 0) {
      transportFailure("tui.cli.no-error", "Failed Lifecycle invocation returned no structured error", {
        exitCode: output.exitCode,
        signal: output.signal,
      });
    }
    const failure = parseFoundationCliErrorJson(output.stderr);
    if (!options.allowReportedEffects && (failure.repositoryChanged || failure.operationalStateChanged)) {
      transportFailure(
        "tui.cli.read-effect",
        "A read-only Lifecycle invocation reported a repository or operational state change",
        { exitCode: output.exitCode, signal: output.signal },
      );
    }
    throw new FoundationCliReportedError(failure, output.exitCode, output.signal);
  }
  if (output.stderr.byteLength !== 0) {
    transportFailure("tui.cli.mixed-output", "Successful Lifecycle invocation produced unsupported stderr");
  }
  return parseFoundationRuntimeOperationResultJson(output.stdout);
}

function expectedOperation(
  result: FoundationRuntimeOperationResult,
  request: FoundationRuntimeOperationRequest,
  operation: FoundationRuntimeOperationKind,
): FoundationRuntimeOperationResult {
  const bound = parseFoundationRuntimeOperationResultForRequest(result, request);
  if (bound.operation !== operation) {
    transportFailure("tui.cli.response-mismatch", "Lifecycle response does not match the exact request");
  }
  return bound;
}

export async function connectLifecycleExecutable(
  executablePath: string,
  options: LifecycleCliCancellation & Readonly<{ environment?: NodeJS.ProcessEnv }> = {},
): Promise<ResolvedLifecycleExecutable> {
  const boundary = invocationBoundary(options);
  assertBoundaryActive(boundary);
  const requestedPath = await resolveLifecycleExecutablePath(executablePath, options.environment);
  assertBoundaryActive(boundary);
  let physicalPath: string;
  try {
    physicalPath = await realpath(requestedPath);
    const metadata = await stat(physicalPath);
    if (!metadata.isFile() || (process.platform !== "win32" && (metadata.mode & 0o111) === 0)) {
      transportFailure("tui.cli.executable-kind", "The selected Lifecycle executable is not an executable regular file");
    }
  } catch (error) {
    if (error instanceof FoundationTuiTransportError) throw error;
    assertBoundaryActive(boundary);
    transportFailure("tui.cli.executable-unavailable", "The selected Lifecycle executable is unavailable");
  }
  assertBoundaryActive(boundary);
  const candidate = Object.freeze({ requestedPath, physicalPath });
  const environment = sanitizedLifecycleEnvironment(options.environment);
  const output = await invokeWithinBoundary(candidate, ["version"], environment, boundary);
  if (output.exitCode !== 0 || output.signal !== null || output.stderr.byteLength !== 0) {
    transportFailure("tui.cli.version", "The selected Lifecycle executable did not return its exact version", {
      exitCode: output.exitCode,
      signal: output.signal,
    });
  }
  const version = parseFoundationRuntimeVersionJson(output.stdout);
  assertBoundaryActive(boundary);
  return Object.freeze({ ...candidate, version });
}

export async function createLifecycleCliTransport(options: Readonly<{
  executable: string;
  environment?: NodeJS.ProcessEnv;
  pinCancellation?: LifecycleCliCancellation;
}>): Promise<LifecycleCliTransport> {
  const executable = await connectLifecycleExecutable(options.executable, {
    ...(options.pinCancellation ?? {}),
    environment: options.environment,
  });
  const environment = sanitizedLifecycleEnvironment(options.environment);
  const deliveryEnvironment = sanitizedLifecycleDeliveryEnvironment(options.environment);
  const prepareEnvironment = sanitizedLifecyclePrepareEnvironment(options.environment);

  const read = async <Operation extends "repository.validate" | "delivery.status">(
    operation: Operation,
    command: "validate" | "status",
    target: string,
    deliveryId: string | null,
    options: LifecycleReadOptions,
  ): Promise<Extract<FoundationRuntimeOperationResult, { operation: Operation }>> => {
    const boundary = invocationBoundary(options);
    try {
      assertBoundaryActive(boundary);
      const selectedTarget = exactTarget(target);
      const request = operation === "delivery.status"
        ? createFoundationRuntimeOperationRequest({ operation, target: selectedTarget, deliveryId: exactDeliveryId(deliveryId!), input: null })
        : createFoundationRuntimeOperationRequest({ operation, target: selectedTarget, input: null });
      const output = await invokeWithinBoundary(
        executable,
        operation === "delivery.status" ? [command, selectedTarget, exactDeliveryId(deliveryId!), "--format", "json"] : [command, selectedTarget, "--format", "json"],
        operation === "repository.validate" ? environment : deliveryEnvironment,
        boundary,
      );
      const parsed = parseSuccessfulOutput(output);
      const result = operation === "repository.validate"
        ? expectedOperation(parsed, request, "repository.validate")
        : expectedOperation(parsed, request, "delivery.status");
      assertBoundaryActive(boundary);
      return result as Extract<FoundationRuntimeOperationResult, { operation: Operation }>;
    } catch (error) {
      assertBoundaryActive(boundary);
      throw error;
    }
  };

  const query = async (
    request: FoundationRuntimeOperationRequest,
    command: "inbox" | "inspect" | "diff" | "watch",
    deliveryId: string | null,
    readOptions: LifecycleReadOptions,
    operationEnvironment: NodeJS.ProcessEnv = deliveryEnvironment,
  ): Promise<FoundationRuntimeOperationResult> => {
    const boundary = invocationBoundary(readOptions);
    let temporaryRoot: string | null = null;
    try {
      assertBoundaryActive(boundary);
      temporaryRoot = await mkdtemp(join(tmpdir(), `lifecycle-tui-${command}-`));
      await chmod(temporaryRoot, 0o700);
      const inputPath = join(temporaryRoot, "query.json");
      await writeFile(inputPath, JSON.stringify(request.input), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await chmod(inputPath, 0o600);
      assertBoundaryActive(boundary);
      const args = deliveryId === null
        ? [command, request.target, "--input", inputPath, "--format", "json"]
        : [command, request.target, exactDeliveryId(deliveryId), "--input", inputPath, "--format", "json"];
      const output = await invokeWithinBoundary(executable, args, operationEnvironment, boundary);
      const result = expectedOperation(parseSuccessfulOutput(output), request, request.operation);
      assertBoundaryActive(boundary);
      return result;
    } catch (error) {
      assertBoundaryActive(boundary);
      throw error;
    } finally {
      if (temporaryRoot !== null) {
        try {
          await rm(temporaryRoot, { recursive: true, force: true });
        } catch {
          transportFailure("tui.cli.temporary-cleanup", "Lifecycle could not remove private read query support");
        }
      }
    }
  };

  const semanticMutation = async (
    target: string,
    deliveryId: string,
    operation: FoundationNextPassOperation,
    semanticMarkdown: string,
    expectedGeneration: string,
    mutationOptions: LifecycleReadOptions,
  ): Promise<FoundationNextPassResult> => {
    const boundary = invocationBoundary(mutationOptions);
    let temporaryRoot: string | null = null;
    try {
      assertBoundaryActive(boundary);
      const selectedTarget = exactTarget(target);
      const selectedDelivery = exactDeliveryId(deliveryId);
      const generation = exactGeneration(expectedGeneration);
      const request = createFoundationRuntimeOperationRequest({
        operation,
        target: selectedTarget,
        deliveryId: selectedDelivery,
        input: { semanticMarkdown, expectedGeneration: generation },
      });
      temporaryRoot = await mkdtemp(join(tmpdir(), "lifecycle-tui-next-pass-"));
      await chmod(temporaryRoot, 0o700);
      const inputPath = join(temporaryRoot, "founder-input.md");
      await writeFile(inputPath, semanticMarkdown, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await chmod(inputPath, 0o600);
      assertBoundaryActive(boundary);
      const command = operation.slice("delivery.".length);
      const output = await invokeWithinBoundary(
        executable,
        [command, selectedTarget, selectedDelivery, "--input", inputPath, "--expected-generation", generation, "--format", "json"],
        prepareEnvironment,
        boundary,
      );
      const result = expectedOperation(
        parseSuccessfulOutput(output, { allowReportedEffects: true }),
        request,
        operation,
      );
      assertBoundaryActive(boundary);
      return result;
    } catch (error) {
      assertBoundaryActive(boundary);
      throw error;
    } finally {
      if (temporaryRoot !== null) {
        try {
          await rm(temporaryRoot, { recursive: true, force: true });
        } catch {
          transportFailure("tui.cli.temporary-cleanup", "Lifecycle could not remove private next-pass input support");
        }
      }
    }
  };

  return Object.freeze({
    executable,
    validate: async (
      target: string,
      readOptions: LifecycleReadOptions = {},
    ): Promise<FoundationValidationResult> => {
      return await read("repository.validate", "validate", target, null, readOptions);
    },
    status: async (
      target: string, deliveryId: string,
      readOptions: LifecycleReadOptions = {},
    ): Promise<FoundationStatusResult> => {
      return await read("delivery.status", "status", target, deliveryId, readOptions);
    },
    inbox: async (
      target: string,
      selected: Readonly<{ afterDeliveryId: string | null; limit: number }> = {
        afterDeliveryId: null,
        limit: 100,
      },
      readOptions: LifecycleReadOptions = {},
    ): Promise<FoundationInboxOperationResult> => {
      const selectedTarget = exactTarget(target);
      const request = createFoundationRuntimeOperationRequest({
        operation: "delivery.inbox",
        target: selectedTarget,
        input: selected,
      });
      return await query(request, "inbox", null, readOptions);
    },
    inspectAttemptView: async (
      target: string,
      deliveryId: string,
      selection: FoundationAttemptViewSelection = { kind: "latest-attempt" },
      readOptions: LifecycleReadOptions = {},
    ): Promise<FoundationAttemptViewResult> => {
      const boundary = invocationBoundary(readOptions);
      let temporaryRoot: string | null = null;
      try {
        assertBoundaryActive(boundary);
        const selectedTarget = exactTarget(target);
        const selectedDelivery = exactDeliveryId(deliveryId);
        const request = createFoundationRuntimeOperationRequest({
          operation: "delivery.inspect",
          target: selectedTarget,
          deliveryId: selectedDelivery,
          input: { kind: "attempt-view", selection },
        });
        temporaryRoot = await mkdtemp(join(tmpdir(), "lifecycle-tui-attempt-view-"));
        await chmod(temporaryRoot, 0o700);
        const inputPath = join(temporaryRoot, "query.json");
        await writeFile(inputPath, JSON.stringify(request.input), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await chmod(inputPath, 0o600);
        assertBoundaryActive(boundary);
        const output = await invokeWithinBoundary(
          executable,
          ["inspect", selectedTarget, selectedDelivery, "--input", inputPath, "--format", "json"],
          deliveryEnvironment,
          boundary,
        );
        const result = expectedOperation(parseSuccessfulOutput(output), request, "delivery.inspect");
        assertBoundaryActive(boundary);
        return result;
      } catch (error) {
        assertBoundaryActive(boundary);
        throw error;
      } finally {
        if (temporaryRoot !== null) {
          try {
            await rm(temporaryRoot, { recursive: true, force: true });
          } catch {
            transportFailure(
              "tui.cli.temporary-cleanup",
              "Lifecycle could not remove private Attempt View query support",
            );
          }
        }
      }
    },
    inspectDeliveryView: async (
      target: string,
      deliveryId: string,
      readOptions: LifecycleReadOptions = {},
    ): Promise<FoundationDeliveryViewResult> => {
      const selectedTarget = exactTarget(target);
      const selectedDelivery = exactDeliveryId(deliveryId);
      const request = createFoundationRuntimeOperationRequest({
        operation: "delivery.inspect",
        target: selectedTarget,
        deliveryId: selectedDelivery,
        input: { kind: "delivery-view" },
      });
      // The Delivery view derives the next-pass Investment from the complete
      // installed provider selection. No authority or provider home enters.
      return await query(request, "inspect", selectedDelivery, readOptions, prepareEnvironment);
    },
    inspectControl: async (
      target: string,
      deliveryId: string,
      selected: FoundationControlInspectionQuery,
      readOptions: LifecycleReadOptions = {},
    ): Promise<FoundationControlInspectionResult> => {
      const selectedTarget = exactTarget(target);
      const selectedDelivery = exactDeliveryId(deliveryId);
      const request = createFoundationRuntimeOperationRequest({
        operation: "delivery.inspect",
        target: selectedTarget,
        deliveryId: selectedDelivery,
        input: selected,
      });
      return await query(request, "inspect", selectedDelivery, readOptions);
    },
    diff: async (
      target: string,
      deliveryId: string,
      selected: Readonly<{ subject: "candidate" | "decision"; maximumBytes: number }>,
      readOptions: LifecycleReadOptions = {},
    ): Promise<FoundationDiffOperationResult> => {
      const selectedTarget = exactTarget(target);
      const selectedDelivery = exactDeliveryId(deliveryId);
      const request = createFoundationRuntimeOperationRequest({
        operation: "delivery.diff",
        target: selectedTarget,
        deliveryId: selectedDelivery,
        input: selected,
      });
      return await query(request, "diff", selectedDelivery, readOptions);
    },
    watch: async (
      target: string,
      selected: Readonly<{
        scope: "inbox" | "delivery";
        deliveryId: string | null;
        afterGeneration: string | null;
        timeoutMs: number;
      }>,
      readOptions: LifecycleReadOptions = {},
    ): Promise<FoundationWatchOperationResult> => {
      const selectedTarget = exactTarget(target);
      const selectedDelivery = selected.deliveryId === null ? null : exactDeliveryId(selected.deliveryId);
      const request = createFoundationRuntimeOperationRequest({
        operation: "delivery.watch",
        target: selectedTarget,
        deliveryId: selectedDelivery,
        input: {
          scope: selected.scope,
          afterGeneration: selected.afterGeneration === null
            ? null
            : exactGeneration(selected.afterGeneration),
          timeoutMs: selected.timeoutMs,
        },
      });
      // Delivery-scoped watch returns a complete Delivery view, including its
      // installed Investment. Inbox watch remains a custody-only aggregate.
      return await query(
        request,
        "watch",
        selectedDelivery,
        readOptions,
        selected.scope === "delivery" ? prepareEnvironment : deliveryEnvironment,
      );
    },
    prepare: async (
      target: string,
      semanticMarkdown: string,
      prepareOptions: LifecycleReadOptions = {},
    ): Promise<FoundationPrepareResult> => {
      const boundary = invocationBoundary(prepareOptions);
      let temporaryRoot: string | null = null;
      try {
        assertBoundaryActive(boundary);
        const selectedTarget = exactTarget(target);
        const request = createFoundationRuntimeOperationRequest({
          operation: "delivery.prepare",
          target: selectedTarget,
          input: { semanticMarkdown },
        });
        temporaryRoot = await mkdtemp(join(tmpdir(), "lifecycle-tui-frame-"));
        await chmod(temporaryRoot, 0o700);
        assertBoundaryActive(boundary);
        const inputPath = join(temporaryRoot, "founder-input.md");
        await writeFile(inputPath, semanticMarkdown, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await chmod(inputPath, 0o600);
        assertBoundaryActive(boundary);
        const output = await invokeWithinBoundary(
          executable,
          ["prepare", selectedTarget, "--input", inputPath, "--format", "json"],
          prepareEnvironment,
          boundary,
        );
        const parsed = parseSuccessfulOutput(output, { allowReportedEffects: true });
        const result = expectedOperation(parsed, request, "delivery.prepare");
        assertBoundaryActive(boundary);
        return result;
      } catch (error) {
        assertBoundaryActive(boundary);
        throw error;
      } finally {
        if (temporaryRoot !== null) {
          try {
            await rm(temporaryRoot, { recursive: true, force: true });
          } catch {
            transportFailure(
              "tui.cli.temporary-cleanup",
              "Lifecycle could not remove private Frame input support",
            );
          }
        }
      }
    },
    executeNextPass: async (
      target: string,
      deliveryId: string,
      operation: FoundationNextPassOperation,
      semanticMarkdown: string,
      expectedGeneration: string,
      mutationOptions: LifecycleReadOptions = {},
    ): Promise<FoundationNextPassResult> => {
      return await semanticMutation(
        target,
        deliveryId,
        operation,
        semanticMarkdown,
        expectedGeneration,
        mutationOptions,
      );
    },
  });
}
