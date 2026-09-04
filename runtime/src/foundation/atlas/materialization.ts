import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { FoundationError } from "../error.js";
import { objectBlobBytes } from "../repository/git.js";
import type { FoundationAtlasState } from "../repository/types.js";

const MAXIMUM_ATLAS_FILES = 100_000;
const MAXIMUM_ATLAS_FILE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_ATLAS_TOTAL_BYTES = 256 * 1024 * 1024;

export type FoundationAtlasMaterialization = Readonly<{
  root: string;
  entrypoint: string;
  cleanup(): Promise<void>;
}>;

function assertOwnedDestination(root: string, path: string): void {
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new FoundationError("lifecycle.atlas.binding-invalid", "Atlas State contains a path outside its private materialization");
  }
}

async function removePrivateMaterialization(root: string, force: boolean): Promise<void> {
  try {
    await rm(root, { recursive: true, force, maxRetries: 2 });
  } catch {
    throw new FoundationError(
      "lifecycle.atlas.processing-incomplete",
      "Atlas private materialization cleanup did not complete",
    );
  }
}

function rethrowMaterializationFailure(error: unknown): never {
  if (error instanceof FoundationError && error.code.startsWith("lifecycle.atlas.")) throw error;
  throw new FoundationError(
    "lifecycle.atlas.processing-incomplete",
    "Atlas State private materialization did not complete",
  );
}

/** Materialize only exact Git blobs from Atlas State into one private owned tree. */
export async function materializeAtlasState(
  repository: string,
  state: FoundationAtlasState,
  entrypoint: string,
): Promise<FoundationAtlasMaterialization> {
  if (state.entries.length > MAXIMUM_ATLAS_FILES) {
    throw new FoundationError("lifecycle.atlas.processing-incomplete", "Atlas State exceeds the processor file-count bound", {
      observedFacts: { actual: state.entries.length, maximum: MAXIMUM_ATLAS_FILES },
    });
  }
  let temporaryRoot: string | null = null;
  try {
    temporaryRoot = await mkdtemp(join(tmpdir(), "lifecycle-atlas-v1-"));
    await chmod(temporaryRoot, 0o700);
  } catch {
    if (temporaryRoot !== null) await removePrivateMaterialization(temporaryRoot, true);
    throw new FoundationError(
      "lifecycle.atlas.processing-incomplete",
      "Atlas private materialization could not be created",
    );
  }
  let totalBytes = 0;
  try {
    for (const entry of state.entries) {
      const destination = resolve(temporaryRoot, entry.path);
      assertOwnedDestination(temporaryRoot, destination);
      const bytes = await objectBlobBytes(repository, entry.objectId, MAXIMUM_ATLAS_FILE_BYTES);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAXIMUM_ATLAS_TOTAL_BYTES) {
        throw new FoundationError("lifecycle.atlas.processing-incomplete", "Atlas State exceeds the processor aggregate-byte bound", {
          observedFacts: { actual: totalBytes, maximum: MAXIMUM_ATLAS_TOTAL_BYTES },
        });
      }
      const parent = dirname(destination);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await chmod(parent, 0o700);
      await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
      await chmod(destination, 0o600);
    }
    const materializedEntrypoint = resolve(temporaryRoot, entrypoint);
    assertOwnedDestination(temporaryRoot, materializedEntrypoint);
    return Object.freeze({
      root: temporaryRoot,
      entrypoint: materializedEntrypoint,
      cleanup: async (): Promise<void> => {
        await removePrivateMaterialization(temporaryRoot, false);
      },
    });
  } catch (error) {
    await removePrivateMaterialization(temporaryRoot, true);
    rethrowMaterializationFailure(error);
  }
}
