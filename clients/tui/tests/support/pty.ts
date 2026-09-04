import { spawn, type ChildProcess } from "node:child_process";
import { constants as osConstants, tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

const DEFAULT_CAPTURE_BYTES = 2 * 1_024 * 1_024;
const HELPER_DIAGNOSTIC_BYTES = 64 * 1_024;
const CONTROL_WRITE_BYTES = 64 * 1_024;
const STATUS_BYTES = 4_096;

const HELPER_SOURCE = String.raw`
#define _DARWIN_C_SOURCE
#define _XOPEN_SOURCE 700
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <util.h>
#else
#include <pty.h>
#endif

#define CONTROL_MAX (64 * 1024)
#define CONTROL_BUFFER (CONTROL_MAX + 5)

static volatile sig_atomic_t caught_signal = 0;

static void remember_signal(int value) {
  caught_signal = value;
}

static long long monotonic_ms(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return 0;
  return ((long long)now.tv_sec * 1000LL) + ((long long)now.tv_nsec / 1000000LL);
}

static int write_all(int descriptor, const unsigned char *bytes, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t written = write(descriptor, bytes + offset, length - offset);
    if (written > 0) {
      offset += (size_t)written;
      continue;
    }
    if (written < 0 && errno == EINTR) continue;
    return -1;
  }
  return 0;
}

static uint32_t read_u32(const unsigned char *bytes) {
  return ((uint32_t)bytes[0] << 24) |
    ((uint32_t)bytes[1] << 16) |
    ((uint32_t)bytes[2] << 8) |
    (uint32_t)bytes[3];
}

static void signal_group(pid_t child, int selected) {
  if (kill(-child, selected) != 0) (void)kill(child, selected);
}

static int apply_control(
  pid_t child,
  int master,
  unsigned char kind,
  const unsigned char *payload,
  uint32_t length
) {
  if (kind == 'W') {
    if (length > CONTROL_MAX) return E2BIG;
    if (write_all(master, payload, length) != 0 && errno != EIO) return errno;
    return 0;
  }
  if (kind == 'R') {
    if (length != 8) return EPROTO;
    uint32_t rows = read_u32(payload);
    uint32_t columns = read_u32(payload + 4);
    if (rows == 0 || rows > 65535 || columns == 0 || columns > 65535) return EINVAL;
    struct winsize size;
    memset(&size, 0, sizeof(size));
    size.ws_row = (unsigned short)rows;
    size.ws_col = (unsigned short)columns;
    if (ioctl(master, TIOCSWINSZ, &size) != 0) return errno;
    signal_group(child, SIGWINCH);
    return 0;
  }
  if (kind == 'S') {
    if (length != 4) return EPROTO;
    uint32_t selected = read_u32(payload);
    if (selected == 0 || selected > 255) return EINVAL;
    signal_group(child, (int)selected);
    return 0;
  }
  return EPROTO;
}

static void report_status(int status, int helper_error) {
  if (helper_error != 0) {
    (void)dprintf(3, "{\"kind\":\"helper-error\",\"errno\":%d}\n", helper_error);
    return;
  }
  if (WIFEXITED(status)) {
    (void)dprintf(3, "{\"kind\":\"exit\",\"exitCode\":%d,\"signal\":null}\n", WEXITSTATUS(status));
    return;
  }
  if (WIFSIGNALED(status)) {
    (void)dprintf(3, "{\"kind\":\"exit\",\"exitCode\":null,\"signal\":%d}\n", WTERMSIG(status));
    return;
  }
  (void)dprintf(3, "{\"kind\":\"helper-error\",\"errno\":%d}\n", ECHILD);
}

int main(int argc, char **argv) {
  if (argc < 4) return 64;
  char *end = NULL;
  unsigned long rows = strtoul(argv[1], &end, 10);
  if (end == argv[1] || *end != '\0' || rows == 0 || rows > 65535) return 64;
  unsigned long columns = strtoul(argv[2], &end, 10);
  if (end == argv[2] || *end != '\0' || columns == 0 || columns > 65535) return 64;

  struct winsize size;
  memset(&size, 0, sizeof(size));
  size.ws_row = (unsigned short)rows;
  size.ws_col = (unsigned short)columns;

  int master = -1;
  pid_t child = forkpty(&master, NULL, NULL, &size);
  if (child < 0) {
    (void)dprintf(3, "{\"kind\":\"helper-error\",\"errno\":%d}\n", errno);
    return 70;
  }
  if (child == 0) {
    (void)close(3);
    execvp(argv[3], &argv[3]);
    _exit(127);
  }

  (void)signal(SIGPIPE, SIG_IGN);
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = remember_signal;
  sigemptyset(&action.sa_mask);
  (void)sigaction(SIGINT, &action, NULL);
  (void)sigaction(SIGTERM, &action, NULL);
  (void)sigaction(SIGHUP, &action, NULL);

  int master_flags = fcntl(master, F_GETFL, 0);
  if (master_flags >= 0) (void)fcntl(master, F_SETFL, master_flags | O_NONBLOCK);
  int control_flags = fcntl(STDIN_FILENO, F_GETFL, 0);
  if (control_flags >= 0) (void)fcntl(STDIN_FILENO, F_SETFL, control_flags | O_NONBLOCK);

  unsigned char control[CONTROL_BUFFER];
  size_t control_used = 0;
  int master_open = 1;
  int control_open = 1;
  int child_done = 0;
  int child_status = 0;
  int helper_error = 0;
  int termination_stage = 0;
  long long termination_deadline = 0;

  while (!child_done || master_open) {
    if (caught_signal != 0 && termination_stage == 0) {
      signal_group(child, caught_signal);
      termination_stage = 1;
      termination_deadline = monotonic_ms() + 500;
    }
    if (!control_open && termination_stage == 0 && !child_done) {
      signal_group(child, SIGHUP);
      termination_stage = 1;
      termination_deadline = monotonic_ms() + 500;
    }
    if (termination_stage == 1 && !child_done && monotonic_ms() >= termination_deadline) {
      signal_group(child, SIGKILL);
      termination_stage = 2;
    }

    if (!child_done) {
      pid_t observed = waitpid(child, &child_status, WNOHANG);
      if (observed == child) child_done = 1;
      else if (observed < 0 && errno != EINTR) {
        helper_error = errno;
        child_done = 1;
      }
    }

    struct pollfd descriptors[2];
    nfds_t count = 0;
    int master_index = -1;
    int control_index = -1;
    if (master_open) {
      master_index = (int)count;
      descriptors[count].fd = master;
      descriptors[count].events = POLLIN | POLLHUP;
      descriptors[count].revents = 0;
      count += 1;
    }
    if (control_open && !child_done) {
      control_index = (int)count;
      descriptors[count].fd = STDIN_FILENO;
      descriptors[count].events = POLLIN | POLLHUP;
      descriptors[count].revents = 0;
      count += 1;
    }

    int ready = poll(descriptors, count, 50);
    if (ready < 0 && errno != EINTR) {
      helper_error = errno;
      signal_group(child, SIGKILL);
    }

    if (master_index >= 0 && (descriptors[master_index].revents & (POLLIN | POLLHUP | POLLERR))) {
      unsigned char bytes[8192];
      for (;;) {
        ssize_t read_count = read(master, bytes, sizeof(bytes));
        if (read_count > 0) {
          if (write_all(STDOUT_FILENO, bytes, (size_t)read_count) != 0) {
            control_open = 0;
            signal_group(child, SIGHUP);
            termination_stage = 1;
            termination_deadline = monotonic_ms() + 500;
            break;
          }
          continue;
        }
        if (read_count == 0 || (read_count < 0 && errno == EIO)) {
          close(master);
          master_open = 0;
        }
        break;
      }
    }

    if (control_index >= 0 && (descriptors[control_index].revents & (POLLIN | POLLHUP | POLLERR))) {
      for (;;) {
        if (control_used == sizeof(control)) {
          helper_error = E2BIG;
          control_open = 0;
          break;
        }
        ssize_t read_count = read(STDIN_FILENO, control + control_used, sizeof(control) - control_used);
        if (read_count > 0) {
          control_used += (size_t)read_count;
          continue;
        }
        if (read_count == 0) control_open = 0;
        break;
      }
      size_t consumed = 0;
      while (control_used - consumed >= 5) {
        unsigned char kind = control[consumed];
        uint32_t length = read_u32(control + consumed + 1);
        if (length > CONTROL_MAX) {
          helper_error = E2BIG;
          control_open = 0;
          break;
        }
        if (control_used - consumed < (size_t)length + 5) break;
        int applied = apply_control(child, master, kind, control + consumed + 5, length);
        if (applied != 0) {
          helper_error = applied;
          control_open = 0;
          break;
        }
        consumed += (size_t)length + 5;
      }
      if (consumed > 0) {
        memmove(control, control + consumed, control_used - consumed);
        control_used -= consumed;
      }
      if (!control_open && !child_done && termination_stage == 0) {
        signal_group(child, SIGHUP);
        termination_stage = 1;
        termination_deadline = monotonic_ms() + 500;
      }
    }

    if (child_done && master_open && ready == 0) {
      unsigned char bytes[8192];
      ssize_t read_count = read(master, bytes, sizeof(bytes));
      if (read_count > 0) (void)write_all(STDOUT_FILENO, bytes, (size_t)read_count);
      else if (read_count == 0 || errno == EIO || errno == EAGAIN) {
        close(master);
        master_open = 0;
      }
    }
  }

  if (!child_done) {
    signal_group(child, SIGKILL);
    while (waitpid(child, &child_status, 0) < 0 && errno == EINTR) {}
  }
  report_status(child_status, helper_error);
  return helper_error == 0 ? 0 : 70;
}
`;

export type PtyViewport = Readonly<{ columns: number; rows: number }>;

export type PtySpawnOptions = Readonly<{
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  viewport?: PtyViewport;
  maximumCaptureBytes?: number;
}>;

export type PtyExit = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  output: Buffer;
  text: string;
  helperStderr: string;
  captureComplete: boolean;
}>;

export class PtyHarnessError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "PtyHarnessError";
    this.code = code;
  }
}

export class PtyTimeoutError extends PtyHarnessError {
  readonly output: Buffer;

  constructor(output: Buffer) {
    super("tui.test-pty.timeout", "PTY child did not exit before its bounded timeout");
    this.name = "PtyTimeoutError";
    this.output = output;
  }
}

export class PtyCaptureLimitError extends PtyHarnessError {
  readonly output: Buffer;

  constructor(output: Buffer) {
    super("tui.test-pty.capture-limit", "PTY child output exceeded its bounded capture");
    this.name = "PtyCaptureLimitError";
    this.output = output;
  }
}

type HelperStatus =
  | Readonly<{ kind: "exit"; exitCode: number | null; signal: number | null }>
  | Readonly<{ kind: "helper-error"; errno: number }>;

function boundedPositive(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new PtyHarnessError("tui.test-pty.option", `${label} must be one positive safe integer`);
  }
  return selected;
}

function signalNumber(signal: NodeJS.Signals | number): number {
  if (typeof signal === "number") {
    if (!Number.isInteger(signal) || signal <= 0 || signal > 255) {
      throw new PtyHarnessError("tui.test-pty.signal", "PTY signal number is outside the supported range");
    }
    return signal;
  }
  const selected = osConstants.signals[signal];
  if (selected === undefined) throw new PtyHarnessError("tui.test-pty.signal", `Unknown PTY signal ${signal}`);
  return selected;
}

function signalName(signal: number | null): NodeJS.Signals | null {
  if (signal === null) return null;
  for (const [name, value] of Object.entries(osConstants.signals)) {
    if (value === signal) return name as NodeJS.Signals;
  }
  return null;
}

function controlFrame(kind: "W" | "R" | "S", payload: Uint8Array): Buffer {
  if (payload.byteLength > CONTROL_WRITE_BYTES) {
    throw new PtyHarnessError("tui.test-pty.control-bound", "PTY control payload exceeds 65536 bytes");
  }
  const frame = Buffer.allocUnsafe(payload.byteLength + 5);
  frame.writeUInt8(kind.charCodeAt(0), 0);
  frame.writeUInt32BE(payload.byteLength, 1);
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(frame, 5);
  return frame;
}

async function writeStream(stream: Writable, value: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error | null): void => {
      if (settled) return;
      settled = true;
      stream.removeListener("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onError = (error: Error): void => finish(error);
    stream.once("error", onError);
    try {
      stream.write(value, finish);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function compileHelper(root: string): Promise<string> {
  const source = join(root, "pty-helper.c");
  const executable = join(root, "pty-helper");
  await writeFile(source, HELPER_SOURCE, { encoding: "utf8", mode: 0o600 });
  const args = [source, "-std=c11", "-Wall", "-Wextra", "-O2", "-o", executable];
  if (process.platform === "linux") args.push("-lutil");
  const child = spawn("/usr/bin/cc", args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
  const result = await new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolve, reject) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
    timeout.unref();
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  if (result.code !== 0 || result.signal !== null) {
    throw new PtyHarnessError(
      "tui.test-pty.compile",
      `PTY helper compilation failed (${result.signal ?? result.code}): ${Buffer.concat(stderr).toString("utf8") || Buffer.concat(stdout).toString("utf8")}`,
    );
  }
  return executable;
}

export class TestPtyProcess {
  /** Keep the helper owner reachable until its process and fd3 status both settle. */
  readonly #child: ChildProcess;
  readonly #controller: Writable;
  readonly #maximumCaptureBytes: number;
  readonly #onSettled: () => void;
  readonly #chunks: Buffer[] = [];
  readonly #listeners = new Set<(chunk: Buffer) => void>();
  readonly #result: Promise<PtyExit>;
  #capturedBytes = 0;
  #captureComplete = true;
  #helperStderr = Buffer.alloc(0);
  #controlTail: Promise<void> = Promise.resolve();
  #settled = false;
  #terminating: Promise<PtyExit> | null = null;

  private constructor(
    child: ChildProcess,
    maximumCaptureBytes: number,
    onSettled: () => void,
  ) {
    this.#child = child;
    this.#controller = child.stdin!;
    this.#maximumCaptureBytes = maximumCaptureBytes;
    this.#onSettled = onSettled;
    const status = child.stdio[3] as Readable;
    const statusChunks: Buffer[] = [];
    let statusBytes = 0;

    child.stdout!.on("data", (value: Buffer) => {
      const chunk = Buffer.from(value);
      const remaining = this.#maximumCaptureBytes - this.#capturedBytes;
      if (remaining > 0) {
        const selected = chunk.subarray(0, remaining);
        this.#chunks.push(selected);
        this.#capturedBytes += selected.byteLength;
        for (const listener of this.#listeners) listener(Buffer.from(selected));
      }
      if (chunk.byteLength > remaining) {
        this.#captureComplete = false;
        void this.terminate(100).catch(() => undefined);
      }
    });
    child.stderr!.on("data", (value: Buffer) => {
      const remaining = HELPER_DIAGNOSTIC_BYTES - this.#helperStderr.byteLength;
      if (remaining > 0) this.#helperStderr = Buffer.concat([this.#helperStderr, Buffer.from(value).subarray(0, remaining)]);
    });
    status.on("data", (value: Buffer) => {
      const chunk = Buffer.from(value);
      const remaining = STATUS_BYTES - statusBytes;
      if (remaining > 0) {
        statusChunks.push(chunk.subarray(0, remaining));
        statusBytes += Math.min(remaining, chunk.byteLength);
      }
      if (chunk.includes(0x0a)) status.destroy();
    });

    this.#result = new Promise<PtyExit>((resolve, reject) => {
      let childClosed = false;
      let statusClosed = false;
      let completed = false;
      const complete = (): void => {
        if (completed || !childClosed || !statusClosed ||
            (this.#child.exitCode === null && this.#child.signalCode === null)) return;
        completed = true;
        try {
          const statusText = Buffer.concat(statusChunks).toString("utf8").trim();
          const parsed = JSON.parse(statusText) as HelperStatus;
          if (parsed.kind === "helper-error") {
            throw new PtyHarnessError(
              "tui.test-pty.helper",
              `PTY helper failed with errno ${parsed.errno}: ${this.#helperStderr.toString("utf8")}`,
            );
          }
          if (parsed.kind !== "exit" ||
              (parsed.exitCode !== null && !Number.isInteger(parsed.exitCode)) ||
              (parsed.signal !== null && !Number.isInteger(parsed.signal))) {
            throw new Error("invalid PTY helper status");
          }
          const output = this.output;
          resolve(Object.freeze({
            exitCode: parsed.exitCode,
            signal: signalName(parsed.signal),
            output,
            text: new TextDecoder().decode(output),
            helperStderr: this.#helperStderr.toString("utf8"),
            captureComplete: this.#captureComplete,
          }));
        } catch (error) {
          reject(error instanceof PtyHarnessError ? error : new PtyHarnessError(
            "tui.test-pty.status",
            "PTY helper returned no valid terminal status",
            { cause: error },
          ));
        }
      };
      const closeStatus = (): void => {
        statusClosed = true;
        complete();
      };
      child.once("error", (error) => {
        if (completed) return;
        completed = true;
        reject(new PtyHarnessError("tui.test-pty.spawn", "PTY helper could not start", { cause: error }));
      });
      child.once("close", () => {
        childClosed = true;
        complete();
      });
      status.once("end", closeStatus);
      status.once("close", closeStatus);
    }).finally(() => {
      this.#settled = true;
      this.#listeners.clear();
      this.#onSettled();
    });
  }

  static async spawn(
    helper: string,
    command: string,
    args: readonly string[],
    options: PtySpawnOptions,
    onSettled: () => void,
  ): Promise<TestPtyProcess> {
    if (command.length === 0 || !command.startsWith("/")) {
      throw new PtyHarnessError("tui.test-pty.command", "PTY test commands must use one absolute executable path");
    }
    const selected = options.viewport ?? { columns: 80, rows: 24 };
    const columns = boundedPositive(selected.columns, 80, "PTY columns");
    const rows = boundedPositive(selected.rows, 24, "PTY rows");
    if (columns > 65_535 || rows > 65_535) {
      throw new PtyHarnessError("tui.test-pty.option", "PTY viewport exceeds the POSIX winsize range");
    }
    const child = spawn(helper, [String(rows), String(columns), command, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.environment, TERM: options.environment?.TERM ?? process.env.TERM ?? "xterm-256color" },
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });
    const selectedProcess = new TestPtyProcess(
      child,
      boundedPositive(options.maximumCaptureBytes, DEFAULT_CAPTURE_BYTES, "PTY maximum capture bytes"),
      onSettled,
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    return selectedProcess;
  }

  get output(): Buffer {
    return Buffer.concat(this.#chunks, this.#capturedBytes);
  }

  get settled(): boolean {
    return this.#settled;
  }

  get text(): string {
    return new TextDecoder().decode(this.output);
  }

  onData(listener: (chunk: Buffer) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  writeKeys(value: string | Uint8Array): Promise<void> {
    const bytes = typeof value === "string"
      ? Buffer.from(value, "utf8")
      : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return this.#control(controlFrame("W", bytes));
  }

  resize(columns: number, rows: number): Promise<void> {
    if (!Number.isInteger(columns) || columns <= 0 || columns > 65_535 ||
        !Number.isInteger(rows) || rows <= 0 || rows > 65_535) {
      throw new PtyHarnessError("tui.test-pty.resize", "PTY resize requires columns and rows from 1 through 65535");
    }
    const payload = Buffer.allocUnsafe(8);
    payload.writeUInt32BE(rows, 0);
    payload.writeUInt32BE(columns, 4);
    return this.#control(controlFrame("R", payload));
  }

  signal(signal: NodeJS.Signals | number): Promise<void> {
    const payload = Buffer.allocUnsafe(4);
    payload.writeUInt32BE(signalNumber(signal), 0);
    return this.#control(controlFrame("S", payload));
  }

  async waitForOutput(pattern: string | RegExp, timeoutMs = 5_000): Promise<string> {
    boundedPositive(timeoutMs, 5_000, "PTY output timeout");
    const matches = (): boolean => {
      const current = this.text;
      if (typeof pattern === "string") return current.includes(pattern);
      pattern.lastIndex = 0;
      return pattern.test(current);
    };
    if (matches()) return this.text;
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => finish(new PtyTimeoutError(this.output)), timeoutMs);
        timeout.unref();
        const remove = this.onData(() => {
          if (matches()) finish();
        });
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          remove();
          if (error) reject(error);
          else resolve();
        };
        void this.#result.then(
          () => finish(new PtyHarnessError("tui.test-pty.early-exit", "PTY child exited before expected output appeared")),
          (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
        );
      });
    } catch (error) {
      if (error instanceof PtyTimeoutError) await this.terminate(250).catch(() => undefined);
      throw error;
    }
    return this.text;
  }

  async wait(timeoutMs = 30_000): Promise<PtyExit> {
    boundedPositive(timeoutMs, 30_000, "PTY wait timeout");
    const timeout = Symbol("timeout");
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timer = new Promise<typeof timeout>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(timeout), timeoutMs);
      timeoutHandle.unref();
    });
    const selected = await Promise.race([this.#result, timer]).finally(() => clearTimeout(timeoutHandle));
    if (selected === timeout) {
      await this.terminate(250).catch(() => undefined);
      throw new PtyTimeoutError(this.output);
    }
    if (!selected.captureComplete) throw new PtyCaptureLimitError(selected.output);
    return selected;
  }

  async terminate(graceMs = 250): Promise<PtyExit> {
    if (this.#terminating !== null) return this.#terminating;
    this.#terminating = (async () => {
      if (!this.#settled) await this.signal("SIGTERM").catch(() => undefined);
      const graceful = Symbol("graceful");
      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeout = new Promise<typeof graceful>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(graceful), Math.max(0, graceMs));
        timeoutHandle.unref();
      });
      const selected = await Promise.race([this.#result, timeout]).finally(() => clearTimeout(timeoutHandle));
      if (selected !== graceful) return selected;
      if (!this.#settled) await this.signal("SIGKILL").catch(() => undefined);
      return await this.#result;
    })();
    return this.#terminating;
  }

  #control(frame: Buffer): Promise<void> {
    if (this.#settled || this.#controller.destroyed) {
      return Promise.reject(new PtyHarnessError("tui.test-pty.closed", "PTY child is already closed"));
    }
    const pending = this.#controlTail.then(async () => writeStream(this.#controller, frame));
    this.#controlTail = pending.catch(() => undefined);
    return pending;
  }
}

export type TestPtyHarnessOptions = Readonly<{ maximumCaptureBytes?: number }>;

export class TestPtyHarness {
  readonly #root: string;
  readonly #helper: string;
  readonly #maximumCaptureBytes: number;
  readonly #processes = new Set<TestPtyProcess>();
  #disposed = false;

  private constructor(root: string, helper: string, maximumCaptureBytes: number) {
    this.#root = root;
    this.#helper = helper;
    this.#maximumCaptureBytes = maximumCaptureBytes;
  }

  static async create(options: TestPtyHarnessOptions = {}): Promise<TestPtyHarness> {
    const root = await mkdtemp(join(tmpdir(), "lifecycle-tui-pty-"));
    try {
      const helper = await compileHelper(root);
      return new TestPtyHarness(
        root,
        helper,
        boundedPositive(options.maximumCaptureBytes, DEFAULT_CAPTURE_BYTES, "PTY maximum capture bytes"),
      );
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  async spawn(command: string, args: readonly string[] = [], options: PtySpawnOptions = {}): Promise<TestPtyProcess> {
    if (this.#disposed) throw new PtyHarnessError("tui.test-pty.disposed", "PTY harness is already disposed");
    let selected: TestPtyProcess | undefined;
    const created = await TestPtyProcess.spawn(
      this.#helper,
      command,
      args,
      { ...options, maximumCaptureBytes: options.maximumCaptureBytes ?? this.#maximumCaptureBytes },
      () => {
        if (selected !== undefined) this.#processes.delete(selected);
      },
    );
    selected = created;
    if (!created.settled) this.#processes.add(created);
    return created;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const failures: unknown[] = [];
    await Promise.all([...this.#processes].map(async (selected) => {
      try {
        await selected.terminate(250);
      } catch (error) {
        failures.push(error);
      }
    }));
    try {
      await rm(this.#root, { recursive: true, force: false });
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new PtyHarnessError("tui.test-pty.cleanup", "PTY harness cleanup was incomplete", {
        cause: failures.length === 1 ? failures[0] : new AggregateError(failures, "PTY cleanup failures"),
      });
    }
  }
}
