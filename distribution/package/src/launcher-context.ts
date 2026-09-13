import type { SpawnSyncReturns } from "node:child_process";
import type {
  DistributionArchitecture,
  DistributionManifest,
} from "./manifest.js";

export type InstallationConfig = Readonly<{
  model: string;
  reasoning: string;
  schema: "lifecycle.distribution-installation-config.private.v1";
}>;

export type DockerPlatform = Readonly<{
  architecture: DistributionArchitecture;
  os: "linux";
}>;

export type HostInstallation = Readonly<{
  codexHome: string;
  dockerConfig: string;
  invocationRoot: string;
  machineHome: string;
  runtimeHome: string;
}>;

export type DockerBoundary = Readonly<{
  endpoint: string;
  environment: NodeJS.ProcessEnv;
  executable: string;
  run(arguments_: readonly string[]): SpawnSyncReturns<Buffer>;
  socketGid: number;
  socketPath: string;
}>;

export type PreparedInvocation = Readonly<{
  arguments: readonly string[];
  mounts: readonly Readonly<{ source: string; target: string; readOnly: boolean }>[];
  target: string | null;
}>;

export type InstalledDistributionContext = Readonly<{
  boundary: DockerBoundary;
  config: InstallationConfig;
  installation: HostInstallation;
  manifest: DistributionManifest;
  platform: DockerPlatform;
}>;
