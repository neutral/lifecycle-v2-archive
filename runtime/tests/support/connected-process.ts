import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

type ChildMessage = Readonly<{
  kind: "checkpoint" | "result" | "failure";
  value: unknown;
}>;

export type ConnectedChildExit = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

export type ConnectedChild = Readonly<{
  pid: number;
  next(): Promise<ChildMessage>;
  kill(): Promise<ConnectedChildExit>;
  finish(): Promise<ConnectedChildExit>;
  resume(): void;
}>;

/** Only subprocess mechanics. Scenario inputs and owner assertions stay in tests. */
export function startConnectedChild(input: Readonly<{
  worker: URL;
  arguments: readonly string[];
  timeoutMilliseconds?: number;
}>): ConnectedChild {
  const timeoutMilliseconds = input.timeoutMilliseconds ?? 180_000;
  const child: ChildProcess = fork(fileURLToPath(input.worker), [...input.arguments], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    execArgv: [],
  });
  if (child.pid === undefined) throw new Error("Connected Runtime worker did not start");
  const queue: ChildMessage[] = [];
  let output = "";
  let closed: ConnectedChildExit | null = null;
  let pending: Readonly<{
    resolve(message: ChildMessage): void;
    reject(error: Error): void;
  }> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const appendOutput = (chunk: Buffer): void => {
    output = `${output}${chunk.toString("utf8")}`.slice(-16_384);
  };
  child.stdout!.on("data", appendOutput);
  child.stderr!.on("data", appendOutput);
  const finishPending = (error?: Error): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (error !== undefined) pending?.reject(error);
    pending = null;
  };
  child.on("message", (value: unknown) => {
    if (value === null || typeof value !== "object" ||
        !["checkpoint", "result", "failure"].includes(String((value as ChildMessage).kind))) {
      child.kill("SIGKILL");
      finishPending(new Error("Connected Runtime worker sent an invalid test message"));
      return;
    }
    const message = value as ChildMessage;
    if (pending !== null) {
      pending.resolve(message);
      finishPending();
    } else queue.push(message);
  });
  child.once("error", (error) => finishPending(error));
  const exit = new Promise<ConnectedChildExit>((resolve) => {
    child.once("close", (code, signal) => {
      closed = Object.freeze({ code, signal });
      finishPending(new Error(`Connected Runtime worker exited before its next checkpoint: ${code} ${signal}\n${output}`));
      resolve(closed);
    });
  });
  return Object.freeze({
    pid: child.pid,
    async next(): Promise<ChildMessage> {
      const queued = queue.shift();
      if (queued !== undefined) return queued;
      if (closed !== null) {
        throw new Error(`Connected Runtime worker has exited: ${JSON.stringify(closed)}\n${output}`);
      }
      if (pending !== null) throw new Error("Only one connected checkpoint wait may be active");
      return await new Promise<ChildMessage>((resolve, reject) => {
        pending = { resolve, reject };
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          finishPending(new Error(`Connected Runtime worker exceeded ${timeoutMilliseconds}ms before its checkpoint\n${output}`));
        }, timeoutMilliseconds);
      });
    },
    async kill(): Promise<ConnectedChildExit> {
      if (closed === null) child.kill("SIGKILL");
      return await exit;
    },
    async finish(): Promise<ConnectedChildExit> {
      if (closed !== null) return closed;
      const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMilliseconds);
      try {
        return await exit;
      } finally {
        clearTimeout(timeout);
      }
    },
    resume(): void {
      if (!child.connected) throw new Error("Connected Runtime worker IPC is closed");
      child.send({ kind: "resume" });
    },
  });
}

export async function connectedWorkerCheckpoint(value: unknown): Promise<void> {
  if (process.send === undefined) throw new Error("Connected Runtime worker requires its parent IPC channel");
  await new Promise<void>((resolve, reject) => {
    process.once("message", (message: unknown) => {
      if (message !== null && typeof message === "object" &&
          (message as { kind?: string }).kind === "resume") resolve();
      else reject(new Error("Connected Runtime worker received another checkpoint command"));
    });
    process.send!({ kind: "checkpoint", value });
  });
}

export async function connectedWorkerResult(action: () => Promise<unknown>): Promise<void> {
  try {
    const value = await action();
    process.send!({ kind: "result", value });
  } catch (error) {
    const failure = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : { message: String(error) };
    process.send!({ kind: "failure", value: failure });
    process.exitCode = 1;
  } finally {
    process.disconnect?.();
  }
}
