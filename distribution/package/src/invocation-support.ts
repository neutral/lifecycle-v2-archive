import { createHash, randomUUID } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalManifestBytes, RUNTIME_INVOCATION_PROTOCOL } from "./manifest.js";

export const INVOCATION_LABEL_PREFIX = "io.lifecycle.runtime-invocation.private.v1";
export const HEARTBEAT_INTERVAL_MS = 500;
export const MISSED_HEARTBEAT_LIMIT = 10;
export const RUNTIME_TMPFS_BYTES = 512 * 1024 * 1024;
export const RUNTIME_INVOCATION_MASK_TMPFS_BYTES = 1024 * 1024;

export function stateRootDigest(machineHome: string): string {
  return `sha256:${createHash("sha256").update(machineHome, "utf8").digest("hex")}`;
}

export function mountArgument(source: string, target: string, readOnly: boolean): string {
  return `type=bind,src=${source},dst=${target}${readOnly ? ",readonly" : ""}`;
}

export function updateRuntimeInvocationHeartbeat(invocationDirectory: string, counter: number): void {
  const path = join(invocationDirectory, "heartbeat");
  const temporary = join(invocationDirectory, `.heartbeat.${randomUUID()}.tmp`);
  writeFileSync(temporary, `${counter}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
}

export function writeRuntimeInvocationSupport(invocationDirectory: string, invocationId: string): void {
  writeFileSync(join(invocationDirectory, "invocation.json"), canonicalManifestBytes({
    heartbeatFile: "/run/lifecycle-invocation/heartbeat",
    heartbeatIntervalMilliseconds: HEARTBEAT_INTERVAL_MS,
    invocationId,
    missedHeartbeatLimit: MISSED_HEARTBEAT_LIMIT,
    schema: RUNTIME_INVOCATION_PROTOCOL,
  }), { flag: "wx", mode: 0o600 });
  updateRuntimeInvocationHeartbeat(invocationDirectory, 0);
}

export function signalExitCode(signal: NodeJS.Signals | null): number {
  return signal === "SIGHUP" ? 129 : signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
}
