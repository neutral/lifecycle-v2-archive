import { spawnSync } from "node:child_process";
import { basename, delimiter, dirname, join } from "node:path";

export type NodeRuntimeCandidateOptions = {
  explicit?: string;
  path?: string;
  platform?: NodeJS.Platform;
  pathDelimiter?: string;
};

export type CompatibleNodeRuntime = {
  path: string;
  version: string;
};

export function nodeRuntimeCandidates(options: NodeRuntimeCandidateOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const executable = platform === "win32" ? "node.exe" : "node";
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string | undefined): void => {
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  add(options.explicit ?? process.env.LIFECYCLE_NODE_PATH);
  const path = options.path ?? process.env.PATH ?? "";
  for (const directory of path.split(options.pathDelimiter ?? delimiter).filter(Boolean)) {
    add(join(directory, executable));
    const parent = dirname(directory);
    if (
      (basename(directory) === "override" || basename(directory) === "fallback") &&
      basename(parent) === "bin" &&
      basename(dirname(parent)) === "dependencies"
    ) {
      add(join(dirname(parent), "node", "bin", executable));
    }
  }
  return candidates;
}

export function probeNodeRuntimeVersion(path: string): string | undefined {
  const result = spawnSync(path, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return undefined;
  const version = result.stdout.trim().replace(/^v/u, "");
  return version || undefined;
}

export function findCompatibleNodeRuntime(
  candidates: string[],
  isSupported: (version: string) => boolean,
  probe: (path: string) => string | undefined = probeNodeRuntimeVersion,
): CompatibleNodeRuntime | undefined {
  for (const path of candidates) {
    const version = probe(path);
    if (version && isSupported(version)) return { path, version };
  }
  return undefined;
}
