import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  discoverRuntimeTestFiles,
  planRuntimeTestBatches,
} from "./runtime-test-plan.mjs";

const runtimeRoot = resolve(import.meta.dirname, "..");
const testDirectory = join(runtimeRoot, "dist", "tests");

if (process.argv.length !== 2) {
  throw new Error("Runtime test runner does not accept arguments");
}

const testFiles = await discoverRuntimeTestFiles(testDirectory, runtimeRoot);

// Package staging temporarily materializes runtime/node_modules so npm can
// bundle the exact production closure. Running that filesystem-owning check
// beside CLI subprocess tests creates a real module-resolution race. Keep the
// rest of the suite parallel, then run each staging owner alone.
const batches = planRuntimeTestBatches(testFiles);

const suiteTempRoot = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-runtime-test-suite-")));
const forwardedSignals = process.platform === "win32"
  ? ["SIGINT", "SIGTERM", "SIGBREAK"]
  : ["SIGINT", "SIGTERM", "SIGHUP"];
let childSignal = null;
let forwardedSignal = null;
let childError;
let cleanupError;
let child;
let exitStatus = 0;

const signalChild = (signal) => {
  if (child === undefined) return;
  try {
    child.kill(process.platform === "win32" && signal === "SIGBREAK" ? "SIGTERM" : signal);
  } catch (error) {
    childError ??= error;
  }
};
const forwardSignal = (signal) => {
  if (forwardedSignal !== null) return;
  forwardedSignal = signal;
  signalChild(signal);
};

for (const signal of forwardedSignals) process.once(signal, forwardSignal);
try {
  for (const batch of batches) {
    if (forwardedSignal !== null || childError !== undefined) break;
    child = spawn(
      process.execPath,
      ["--test", `--test-concurrency=${batch.concurrency}`, ...batch.files],
      {
        cwd: runtimeRoot,
        env: {
          ...process.env,
          TMPDIR: suiteTempRoot,
          TMP: suiteTempRoot,
          TEMP: suiteTempRoot,
        },
        stdio: "inherit",
        shell: false,
      },
    );
    child.on("error", (error) => {
      childError ??= error;
    });
    if (forwardedSignal !== null) signalChild(forwardedSignal);
    const [status, signal] = await new Promise((resolveChild) => {
      child.once("close", (closedStatus, closedSignal) => resolveChild([closedStatus, closedSignal]));
    });
    child = undefined;
    childSignal = signal;
    if (signal !== null) break;
    if ((status ?? 1) !== 0) exitStatus = status ?? 1;
  }
} finally {
  for (const signal of forwardedSignals) process.removeListener(signal, forwardSignal);
  try {
    await rm(suiteTempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    cleanupError = error;
  }
}

if (childError !== undefined) {
  console.error(`Runtime test process failed: ${childError instanceof Error ? childError.message : String(childError)}`);
}
if (cleanupError !== undefined) {
  console.error(`Runtime test temporary root cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
}

const resultingSignal = forwardedSignal ?? childSignal;
if (resultingSignal !== null) {
  if (process.platform === "win32") {
    process.exitCode = 1;
  } else {
    try {
      process.kill(process.pid, resultingSignal);
    } catch {
      process.exitCode = 1;
    }
  }
} else {
  const completedStatus = childError === undefined ? exitStatus : 1;
  process.exitCode = cleanupError !== undefined && completedStatus === 0 ? 1 : completedStatus;
}
