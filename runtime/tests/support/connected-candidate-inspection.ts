import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { importCandidateRevisionCarrierIntoRepository } from "../../src/foundation/candidate/carrier-import.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";
import { git } from "../../src/foundation/repository/git.js";
import type { Sha256 } from "../../src/foundation/validation/canonical.js";
import type { ConnectedDeliveryFixture } from "./connected-delivery-fixture.js";

/** Read actual retained Product bytes through the Carrier import owner. */
export async function readConnectedCandidateFiles(fixture: ConnectedDeliveryFixture, paths: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const candidate = fixture.current("candidate");
  const tree = String((candidate.payload.state as ControlJsonObject).tree);
  const manifest = await fixture.store.readRetainedFile((candidate.payload.carrierManifest as ControlJsonObject).digest as Sha256);
  assert(manifest !== null);
  const repository = await mkdtemp(join(fixture.workspace, "inspect-candidate-"));
  try {
    await git(repository, ["init", "-b", "inspection"]);
    await importCandidateRevisionCarrierIntoRepository({ machineHome: fixture.machineHome, repository, manifestBytes: manifest.bytes, expectedRootTree: tree });
    return new Map(await Promise.all(paths.map(async (path) => [path, (await git(repository, ["show", `${tree}:${path}`])).stdout] as const)));
  } finally { await rm(repository, { recursive: true, force: true }); }
}

export async function readConnectedCandidateFile(fixture: ConnectedDeliveryFixture, path: string): Promise<string> {
  return (await readConnectedCandidateFiles(fixture, [path])).get(path)!;
}
