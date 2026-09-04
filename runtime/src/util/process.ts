import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { LifecycleError } from "../errors.js";

export type ProcessCancellation = {
  /** First-stage cancellation. Null deliberately suppresses inherited cancellation for bounded cleanup. */
  signal?: AbortSignal | null;
  /** Second-stage cancellation. This immediately kills the owned subprocess group. */
  forceSignal?: AbortSignal | null;
};

const PROCESS_TERMINATION_GRACE_MS = 1_000;
const PROCESS_GROUP_SWEEP_ATTEMPTS = 100;
const PROCESS_GROUP_SWEEP_DELAY_MS = 10;
const operationCancellation = new AsyncLocalStorage<ProcessCancellation>();

function selectedSignal(
  explicit: AbortSignal | null | undefined,
  inherited: AbortSignal | null | undefined,
): AbortSignal | undefined {
  const selected = explicit === undefined ? inherited : explicit;
  return selected ?? undefined;
}

function effectiveCancellation(options: ProcessCancellation): { signal?: AbortSignal; forceSignal?: AbortSignal } {
  const inherited = operationCancellation.getStore();
  return {
    signal: selectedSignal(options.signal, inherited?.signal),
    forceSignal: selectedSignal(options.forceSignal, inherited?.forceSignal),
  };
}

/** Bind CLI-owned cancellation to every generic subprocess reached by this async operation. */
export async function withProcessCancellation<T>(cancellation: ProcessCancellation, operation: () => Promise<T>): Promise<T> {
  const inherited = operationCancellation.getStore();
  return await operationCancellation.run({
    signal: cancellation.signal === undefined ? inherited?.signal : cancellation.signal,
    forceSignal: cancellation.forceSignal === undefined ? inherited?.forceSignal : cancellation.forceSignal,
  }, operation);
}

/**
 * Defer the first signal across one already-entered bounded critical section
 * while retaining the repeated-signal escape hatch. Callers must establish an
 * explicit cancellation safe point before using this for recovery cleanup or
 * authenticated authority projection; ordinary productive work stays
 * cancellable.
 */
export async function withFirstSignalDeferred<T>(operation: () => Promise<T>, forceSignal?: AbortSignal): Promise<T> {
  const inherited = operationCancellation.getStore();
  return await operationCancellation.run({
    signal: null,
    forceSignal: forceSignal ?? inherited?.forceSignal ?? null,
  }, operation);
}

export function throwIfProcessCancellationRequested(signal?: AbortSignal): void {
  const selected = signal ?? effectiveCancellation({}).signal;
  if (!selected?.aborted) return;
  throw new LifecycleError({
    code: "runtime.interrupted",
    message: "Lifecycle was interrupted before the next state transition",
    retryable: true,
  });
}

export function isProcessCancellationError(error: unknown): boolean {
  return error instanceof LifecycleError && ["command.interrupted", "codex.interrupted", "runtime.interrupted"].includes(error.code);
}

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  timedOut?: boolean;
  /** True only when an explicitly requested detached-process-group sweep established absence. */
  processGroupSwept?: boolean;
};

export type CommandBytesResult = {
  stdout: Buffer;
  /** Exact captured stderr bytes; `stderr` is the bounded UTF-8 display form. */
  stderrBytes: Buffer;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  timedOut?: boolean;
  /** True only when an explicitly requested detached-process-group sweep established absence. */
  processGroupSwept?: boolean;
};

type CommandOptions<Input extends string | Buffer> = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input?: Input;
  allowFailure?: boolean;
  /** Bound captured stdout bytes and terminate the child once the cap is reached. */
  maxStdoutBytes?: number;
  /** Bound captured stderr bytes and terminate the child once the cap is reached. */
  maxStderrBytes?: number;
  /** Terminate the child after this wall-clock bound. */
  timeoutMs?: number;
  /** Sweep and verify the complete owned detached process group after the direct child exits. */
  sweepProcessGroupOnClose?: boolean;
} & ProcessCancellation;

function runCommandInternal(
  stdoutMode: "text",
  command: string,
  args: string[],
  options: CommandOptions<string>,
): Promise<CommandResult>;
function runCommandInternal(
  stdoutMode: "bytes",
  command: string,
  args: string[],
  options: CommandOptions<string | Buffer>,
): Promise<CommandBytesResult>;
async function runCommandInternal(
  stdoutMode: "text" | "bytes",
  command: string,
  args: string[],
  options: CommandOptions<string | Buffer>,
): Promise<CommandResult | CommandBytesResult> {
  return await new Promise<CommandResult | CommandBytesResult>((resolve, reject) => {
    const cancellation = effectiveCancellation(options);
    if (cancellation.signal?.aborted || cancellation.forceSignal?.aborted) {
      reject(new LifecycleError({
        code: "command.interrupted",
        message: `Lifecycle interrupted ${command} before it started`,
        retryable: true,
      }));
      return;
    }
    const detachedProcessGroup = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: detachedProcessGroup,
    });
    let processGroupSwept = false;
    let textStdout = "";
    const byteStdout: Buffer[] = [];
    let textStderr = "";
    const byteStderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let timedOut = false;
    let interrupted = false;
    let forced = false;
    let settled = false;
    const killProcessGroup = (signal: NodeJS.Signals): void => {
      if (detachedProcessGroup && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          // Final group absence, not the intermediate signal result, owns the
          // cleanup fact established below.
        }
      }
      try {
        child.kill(signal);
      } catch {
        // The direct child may already have exited while descendants remain in
        // the detached group.
      }
    };
    const processGroupAbsent = (): boolean => {
      if (!detachedProcessGroup || child.pid === undefined) return false;
      try {
        process.kill(-child.pid, 0);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
        return false;
      }
    };
    const sweepProcessGroup = async (): Promise<boolean> => {
      if (!detachedProcessGroup || child.pid === undefined) return false;
      if (processGroupAbsent()) return true;
      killProcessGroup("SIGKILL");
      for (let attempt = 0; attempt < PROCESS_GROUP_SWEEP_ATTEMPTS; attempt += 1) {
        if (processGroupAbsent()) return true;
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, PROCESS_GROUP_SWEEP_DELAY_MS));
      }
      return false;
    };
    const terminate = (): void => {
      if (killTimer) return;
      killProcessGroup("SIGTERM");
      killTimer = setTimeout(() => killProcessGroup("SIGKILL"), PROCESS_TERMINATION_GRACE_MS);
      killTimer.unref();
    };
    const forceTerminate = (): void => {
      forced = true;
      killProcessGroup("SIGKILL");
    };
    if (options.sweepProcessGroupOnClose) {
      // `close` can be delayed while a background descendant retains the
      // child's stdio. Start the sweep at direct-child exit, then establish
      // complete group absence before settling the command promise.
      child.once("exit", () => killProcessGroup("SIGKILL"));
    }
    const abort = (): void => {
      interrupted = true;
      terminate();
    };
    const forceAbort = (): void => {
      interrupted = true;
      forceTerminate();
    };
    const cleanListeners = (): void => {
      cancellation.signal?.removeEventListener("abort", abort);
      cancellation.forceSignal?.removeEventListener("abort", forceAbort);
    };
    cancellation.signal?.addEventListener("abort", abort, { once: true });
    cancellation.forceSignal?.addEventListener("abort", forceAbort, { once: true });
    if (cancellation.signal?.aborted) abort();
    if (cancellation.forceSignal?.aborted) forceAbort();
    if (options.timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, options.timeoutMs);
      timeoutTimer.unref();
    }
    const capturedStdout = (): string | Buffer => stdoutMode === "text"
      ? textStdout
      : Buffer.concat(byteStdout, stdoutBytes);
    const capturedStderrBytes = (): Buffer => stdoutMode === "text"
      ? Buffer.from(textStderr, "utf8")
      : Buffer.concat(byteStderr, stderrBytes);
    const capturedStderr = (): string => stdoutMode === "text"
      ? textStderr
      : capturedStderrBytes().toString("utf8");
    if (stdoutMode === "text") child.stdout.setEncoding("utf8");
    if (stdoutMode === "text") child.stderr.setEncoding("utf8");
    if (stdoutMode === "text") {
      child.stdout.on("data", (chunk: string) => {
        if (options.maxStdoutBytes === undefined) {
          textStdout += chunk;
          return;
        }
        const remaining = Math.max(0, options.maxStdoutBytes - stdoutBytes);
        const bytes = Buffer.from(chunk, "utf8");
        if (remaining > 0) {
          const retained = bytes.subarray(0, remaining);
          textStdout += retained.toString("utf8");
          stdoutBytes += retained.byteLength;
        }
        if (bytes.byteLength > remaining && !stdoutTruncated) {
          stdoutTruncated = true;
          terminate();
        }
      });
    } else {
      child.stdout.on("data", (chunk: Buffer) => {
        if (options.maxStdoutBytes === undefined) {
          const retained = Buffer.from(chunk);
          byteStdout.push(retained);
          stdoutBytes += retained.byteLength;
          return;
        }
        const remaining = Math.max(0, options.maxStdoutBytes - stdoutBytes);
        if (remaining > 0) {
          const retained = Buffer.from(chunk.subarray(0, remaining));
          byteStdout.push(retained);
          stdoutBytes += retained.byteLength;
        }
        if (chunk.byteLength > remaining && !stdoutTruncated) {
          stdoutTruncated = true;
          terminate();
        }
      });
    }
    child.stderr.on("data", (chunk: string | Buffer) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
      if (options.maxStderrBytes === undefined) {
        if (stdoutMode === "text") textStderr += bytes.toString("utf8");
        else byteStderr.push(bytes);
        stderrBytes += bytes.byteLength;
        return;
      }
      const remaining = Math.max(0, options.maxStderrBytes - stderrBytes);
      if (remaining > 0) {
        const retained = bytes.subarray(0, remaining);
        if (stdoutMode === "text") textStderr += retained.toString("utf8");
        else byteStderr.push(Buffer.from(retained));
        stderrBytes += retained.byteLength;
      }
      if (bytes.byteLength > remaining && !stderrTruncated) {
        stderrTruncated = true;
        terminate();
      }
    });
    child.stdin.on("error", () => {
      // A child that exits during interruption or startup can close stdin
      // before the empty/default input is written. Its terminal event below
      // carries the authoritative result.
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (killTimer || forced) killProcessGroup("SIGKILL");
      if (killTimer) clearTimeout(killTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      cleanListeners();
      if (interrupted) {
        reject(new LifecycleError({
          code: "command.interrupted",
          message: `Lifecycle interrupted ${command}`,
          retryable: true,
          observedFacts: { cause: error.message, forced },
        }));
      } else reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      void (async () => {
        // The direct child may exit while a descendant remains in the group.
        // Complete and verify the requested sweep before reporting a result.
        if (killTimer || forced) killProcessGroup("SIGKILL");
        if (killTimer) clearTimeout(killTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        cleanListeners();
        if (options.sweepProcessGroupOnClose) processGroupSwept = await sweepProcessGroup();
        const exitCode = code ?? 1;
        const stdout = capturedStdout();
        const stderr = capturedStderr();
        const exactStderr = capturedStderrBytes();
        if (interrupted) {
          reject(new LifecycleError({
            code: "command.interrupted",
            message: `Lifecycle interrupted ${command}`,
            retryable: true,
            observedFacts: {
              exitCode: code,
              signal,
              stdout,
              stderr,
              ...(stdoutMode === "bytes" ? { stderrBytes: exactStderr } : {}),
              stdoutTruncated,
              stderrTruncated,
              forced,
              ...(options.sweepProcessGroupOnClose === undefined ? {} : { processGroupSwept }),
            },
          }));
        } else if (exitCode !== 0 && !options.allowFailure) {
          reject(
            new LifecycleError({
              code: "command.failed",
              message: `${command} ${args.join(" ")} failed with exit ${exitCode}`,
              observedFacts: {
                stdout,
                stderr,
                ...(stdoutMode === "bytes" ? { stderrBytes: exactStderr } : {}),
                exitCode,
                signal,
                stdoutTruncated,
                stderrTruncated,
                timedOut,
                ...(options.sweepProcessGroupOnClose === undefined ? {} : { processGroupSwept }),
              },
            }),
          );
        } else {
          const result = {
            stderr,
            ...(stdoutMode === "bytes" ? { stderrBytes: exactStderr } : {}),
            exitCode,
            signal,
            ...(options.maxStdoutBytes === undefined ? {} : { stdoutTruncated }),
            ...(options.maxStderrBytes === undefined ? {} : { stderrTruncated }),
            ...(options.timeoutMs === undefined ? {} : { timedOut }),
            ...(options.sweepProcessGroupOnClose === undefined ? {} : { processGroupSwept }),
          };
          if (stdoutMode === "text") resolve({ stdout: textStdout, ...result });
          else resolve({ stdout: Buffer.concat(byteStdout, stdoutBytes), ...result } as CommandBytesResult);
        }
      })().catch(reject);
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions<string>,
): Promise<CommandResult> {
  return await runCommandInternal("text", command, args, options);
}

/** Run one owned subprocess while preserving stdout as exact captured bytes. */
export async function runCommandBytes(
  command: string,
  args: string[],
  options: CommandOptions<string | Buffer>,
): Promise<CommandBytesResult> {
  return await runCommandInternal("bytes", command, args, options);
}
