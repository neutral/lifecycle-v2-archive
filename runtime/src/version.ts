import { gte, valid } from "semver";
import { FOUNDATION_RUNTIME_PROTOCOL } from "./foundation/constants.js";

export const RUNTIME_VERSION = "1.0.0" as const;
export const RUNTIME_MINIMUM_NODE_VERSION = "24.14.0" as const;
export const RUNTIME_PROTOCOL = FOUNDATION_RUNTIME_PROTOCOL;

export const CODEX_COMPATIBILITY = {
  executableRange: ">=0.153.4 <0.154.0",
  generatedWith: "0.153.4",
  protocol: "exec-jsonl-v1",
} as const;

export function isSupportedNodeVersion(version: string): boolean {
  return valid(version) !== null && gte(version, RUNTIME_MINIMUM_NODE_VERSION);
}
