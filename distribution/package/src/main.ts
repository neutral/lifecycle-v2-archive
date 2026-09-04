import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseDistributionManifestBytes } from "./manifest.js";
import { runDistributionLauncher, type DistributionCommand } from "./launcher.js";

const manifestUrl = new URL("../../manifest/distribution-manifest.json", import.meta.url);
const manifestDigestUrl = new URL("../../manifest/distribution-manifest.sha256", import.meta.url);

export async function runInstalledLauncher(
  command: DistributionCommand,
  arguments_: readonly string[],
): Promise<number> {
  try {
    const [manifestBytes, selectedDigestBytes] = await Promise.all([
      readFile(manifestUrl),
      readFile(manifestDigestUrl),
    ]);
    const observedDigest = `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}\n`;
    if (selectedDigestBytes.toString("ascii") !== observedDigest) {
      throw new TypeError("Distribution Manifest digest sidecar does not match its exact bytes");
    }
    const manifest = parseDistributionManifestBytes(manifestBytes);
    return await runDistributionLauncher(command, arguments_, manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown manifest failure";
    process.stderr.write(`Lifecycle distribution failed: ${message}\n`);
    return 1;
  }
}
