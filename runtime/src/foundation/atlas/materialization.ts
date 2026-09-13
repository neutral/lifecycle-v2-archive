import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { FoundationError } from "../error.js";
import { objectBlobBatchBytes } from "../repository/git.js";
import type { FoundationAtlasState, FoundationGitTreeEntry } from "../repository/types.js";
import { sha256Bytes, type Sha256 } from "../validation/canonical.js";

const MAXIMUM_ATLAS_FILES = 100_000;
const MAXIMUM_ATLAS_FILE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_ATLAS_TOTAL_BYTES = 256 * 1024 * 1024;

export type FoundationAtlasMaterialization = Readonly<{
  root: string;
  entrypoint: string;
  cleanup(): Promise<void>;
}>;

type ObservedBlobFact = Readonly<{ byteLength: number; digest: Sha256 }>;
const observedMaterializations = new WeakMap<FoundationAtlasMaterialization, Readonly<{
  repository: string;
  state: FoundationAtlasState;
  stateDigest: Sha256;
  blobs: ReadonlyMap<string, Readonly<{ objectId: string; mode: string; fact: ObservedBlobFact }>>;
}>>();

/** Reuse only bytes observed by this still-owned materialization of the exact Atlas State. */
export function observedAtlasMaterializationBlobFact(
  materialization: FoundationAtlasMaterialization | undefined,
  repository: string,
  state: FoundationAtlasState,
  entry: FoundationGitTreeEntry,
): ObservedBlobFact | null {
  const observed = materialization === undefined ? undefined : observedMaterializations.get(materialization);
  if (observed === undefined || observed.repository !== repository || observed.state !== state ||
      observed.stateDigest !== state.digest || entry.type !== "blob" || entry.mode !== "100644") return null;
  const blob = observed.blobs.get(entry.path);
  return blob?.objectId === entry.objectId && blob.mode === entry.mode ? blob.fact : null;
}

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
  const blobs = new Map<string, Readonly<{ objectId: string; mode: string; fact: ObservedBlobFact }>>();
  try {
    for (const entry of state.entries) {
      assertOwnedDestination(temporaryRoot, resolve(temporaryRoot, entry.path));
      if (entry.mode !== "100644") {
        throw new FoundationError("lifecycle.atlas.binding-invalid", "Atlas State contains a non-regular or executable entry");
      }
    }
    const observed = await objectBlobBatchBytes(
      repository,
      state.entries.map(({ objectId }) => objectId),
      MAXIMUM_ATLAS_FILE_BYTES,
      MAXIMUM_ATLAS_TOTAL_BYTES,
    );
    for (const entry of state.entries) {
      const destination = resolve(temporaryRoot, entry.path);
      assertOwnedDestination(temporaryRoot, destination);
      const bytes = observed.get(entry.objectId)!;
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
      blobs.set(entry.path, Object.freeze({
        objectId: entry.objectId,
        mode: entry.mode,
        fact: Object.freeze({ byteLength: bytes.byteLength, digest: sha256Bytes(bytes) }),
      }));
    }
    const materializedEntrypoint = resolve(temporaryRoot, entrypoint);
    assertOwnedDestination(temporaryRoot, materializedEntrypoint);
    const materialization: FoundationAtlasMaterialization = Object.freeze({
      root: temporaryRoot,
      entrypoint: materializedEntrypoint,
      cleanup: async (): Promise<void> => {
        observedMaterializations.delete(materialization);
        await removePrivateMaterialization(temporaryRoot, false);
      },
    });
    observedMaterializations.set(materialization, Object.freeze({
      repository, state, stateDigest: state.digest, blobs,
    }));
    return materialization;
  } catch (error) {
    await removePrivateMaterialization(temporaryRoot, true);
    rethrowMaterializationFailure(error);
  }
}
