import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { FoundationError } from "../error.js";
import { objectBlobBytes } from "../repository/git.js";
import { compareCodePoints } from "../validation/ordering.js";
import {
  candidateRevisionCarrierVerificationParent,
  openCandidateRevisionCarrier,
} from "./carrier-store.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  type FoundationCandidateRevisionCarrierLimitsV1,
  type FoundationCandidateRevisionCarrierTreeEntryV1,
} from "./carrier-types.js";
import { withVerifiedCandidateRevisionCarrierRepository } from "./git-object-closure.js";

const HASH_BUFFER_BYTES = 1024 * 1024;

function invalid(message: string, observedFacts?: unknown): never {
  throw new FoundationError("lifecycle.candidate.materialization-invalid", message, {
    observedFacts,
  });
}

function within(parent: string, child: string): boolean {
  const displacement = relative(parent, child);
  return displacement === "" || (
    displacement !== ".." &&
    !displacement.startsWith(`..${sep}`) &&
    !isAbsolute(displacement)
  );
}

async function exactPrivateParent(path: string): Promise<string> {
  const requested = resolve(path);
  let physical: string;
  let state: Awaited<ReturnType<typeof lstat>>;
  try {
    [physical, state] = await Promise.all([realpath(requested), lstat(requested)]);
  } catch (error) {
    invalid("Candidate materialization parent is unavailable", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const effectiveUid = process.geteuid?.() ?? process.getuid?.();
  if (
    state.isSymbolicLink() ||
    !state.isDirectory() ||
    (state.mode & 0o7777) !== 0o700 ||
    (effectiveUid !== undefined && state.uid !== effectiveUid)
  ) {
    invalid("Candidate materialization parent must be one exact private directory");
  }
  return physical;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeBlob(
  repository: string,
  root: string,
  entry: FoundationCandidateRevisionCarrierTreeEntryV1,
  limits: FoundationCandidateRevisionCarrierLimitsV1,
): Promise<void> {
  const segments = entry.path.split("/");
  const fileName = segments.pop();
  if (fileName === undefined) invalid("Candidate materialization selected an empty repository path");
  let parent = root;
  for (const segment of segments) {
    parent = join(parent, segment);
    try {
      await mkdir(parent, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const state = await lstat(parent);
    if (state.isSymbolicLink() || !state.isDirectory()) {
      invalid("Candidate materialization directory was substituted during construction", {
        path: relative(root, parent).split(sep).join("/"),
      });
    }
    // The complete staging tree was created by this operation under one
    // private parent, so normalizing these known directories cannot mutate an
    // unknown caller-owned path.
    await chmod(parent, 0o700);
  }
  const destination = join(parent, fileName);
  if (!within(root, destination)) invalid("Candidate materialization path escaped its selected root");
  const bytes = await objectBlobBytes(
    repository,
    entry.objectId,
    entry.byteLength,
    limits.commandTimeoutMs,
  );
  if (bytes.byteLength !== entry.byteLength) {
    invalid("Candidate materialization blob length changed after Carrier verification", {
      expected: entry.byteLength,
      objectId: entry.objectId,
      observed: bytes.byteLength,
    });
  }
  const mode = entry.mode === "100755" ? 0o755 : 0o644;
  const handle = await open(destination, "wx", mode);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  await chmod(destination, mode);
}

async function gitBlobIdentity(
  path: string,
  byteLength: number,
  objectFormat: "sha1" | "sha256",
): Promise<string> {
  const handle = await open(path, "r");
  try {
    const state = await handle.stat({ bigint: true });
    if (state.size !== BigInt(byteLength)) {
      invalid("Candidate materialization file length does not match its Carrier object", {
        expected: byteLength,
        observed: state.size.toString(),
      });
    }
    const hash = createHash(objectFormat);
    hash.update(`blob ${byteLength}\0`, "utf8");
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    let observed = 0;
    for (;;) {
      const result = await handle.read(buffer, 0, buffer.byteLength, null);
      if (result.bytesRead === 0) break;
      observed += result.bytesRead;
      if (observed > byteLength) invalid("Candidate materialization file changed during validation");
      hash.update(buffer.subarray(0, result.bytesRead));
    }
    if (observed !== byteLength) invalid("Candidate materialization file changed during validation");
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

function maximumPhysicalEntries(
  treeEntries: readonly FoundationCandidateRevisionCarrierTreeEntryV1[],
  limits: FoundationCandidateRevisionCarrierLimitsV1,
): number {
  if (treeEntries.length < 1 || treeEntries.length > limits.maximumTreeEntries) {
    invalid("Candidate materialization Carrier inventory is outside its entry bound", {
      maximumTreeEntries: limits.maximumTreeEntries,
      observedTreeEntries: treeEntries.length,
    });
  }
  let maximum = 0;
  for (const entry of treeEntries) {
    const contribution = entry.path.split("/").length;
    if (maximum > Number.MAX_SAFE_INTEGER - contribution) {
      invalid("Candidate materialization physical-entry bound is not one safe integer");
    }
    maximum += contribution;
  }
  return maximum;
}

async function materializedFiles(
  root: string,
  bounds: Readonly<{
    maximumFiles: number;
    maximumPhysicalEntries: number;
  }>,
): Promise<readonly string[]> {
  const files: string[] = [];
  const pending = [root];
  let physicalEntries = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const state = await lstat(directory);
    if (state.isSymbolicLink() || !state.isDirectory() || (state.mode & 0o7777) !== 0o700) {
      invalid("Candidate materialization contains a noncanonical directory");
    }
    let empty = true;
    const entries = await opendir(directory);
    for await (const entry of entries) {
      empty = false;
      physicalEntries += 1;
      if (physicalEntries > bounds.maximumPhysicalEntries) {
        invalid("Candidate materialization exceeds its Carrier-derived physical-entry bound", {
          maximumPhysicalEntries: bounds.maximumPhysicalEntries,
          observedAtLeast: physicalEntries,
        });
      }
      const child = join(directory, entry.name);
      const displacement = relative(root, child).split(sep).join("/");
      if (entry.name.toLowerCase() === ".git") {
        invalid("Candidate materialization contains a forbidden .git entry");
      }
      if (entry.isDirectory()) {
        pending.push(child);
      } else if (entry.isFile()) {
        if (files.length >= bounds.maximumFiles) {
          invalid("Candidate materialization exceeds its declared file count", {
            maximumFiles: bounds.maximumFiles,
            observedAtLeast: files.length + 1,
          });
        }
        files.push(displacement);
      } else {
        invalid("Candidate materialization contains a link or special filesystem entry", {
          path: displacement,
        });
      }
    }
    if (directory !== root && empty) {
      invalid("Candidate materialization contains an unrepresented empty directory");
    }
  }
  return Object.freeze(files.sort(compareCodePoints));
}

export async function verifyCandidateRevisionCarrierMaterialization(input: Readonly<{
  root: string;
  objectFormat: "sha1" | "sha256";
  treeEntries: readonly FoundationCandidateRevisionCarrierTreeEntryV1[];
  limits?: FoundationCandidateRevisionCarrierLimitsV1;
}>): Promise<void> {
  const limits = input.limits ?? FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1;
  const observedPaths = await materializedFiles(input.root, Object.freeze({
    maximumFiles: input.treeEntries.length,
    maximumPhysicalEntries: maximumPhysicalEntries(input.treeEntries, limits),
  }));
  const expectedPaths = input.treeEntries.map(({ path }) => path);
  if (
    observedPaths.length !== expectedPaths.length ||
    observedPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    invalid("Candidate materialization does not contain exactly its Carrier paths", {
      expectedCount: expectedPaths.length,
      observedCount: observedPaths.length,
    });
  }
  for (const entry of input.treeEntries) {
    const path = join(input.root, ...entry.path.split("/"));
    const state = await lstat(path, { bigint: true });
    const expectedMode = entry.mode === "100755" ? 0o755n : 0o644n;
    const effectiveUid = process.geteuid?.() ?? process.getuid?.();
    if (
      !state.isFile() ||
      state.isSymbolicLink() ||
      state.nlink !== 1n ||
      (state.mode & 0o7777n) !== expectedMode ||
      (effectiveUid !== undefined && state.uid !== BigInt(effectiveUid))
    ) {
      invalid("Candidate materialization file is not one exact regular file", {
        path: entry.path,
      });
    }
    const objectId = await gitBlobIdentity(
      path,
      entry.byteLength,
      input.objectFormat,
    );
    if (objectId !== entry.objectId) {
      invalid("Candidate materialization file bytes do not match their Carrier object", {
        expected: entry.objectId,
        observed: objectId,
        path: entry.path,
      });
    }
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Materialize one exact Carrier tree into a fresh private destination.
 * The result contains no .git directory, commit, index, branch, or cache.
 */
export async function materializeCandidateRevisionCarrier(input: Readonly<{
  machineHome: string;
  manifestBytes: Uint8Array;
  destination: string;
  limits?: FoundationCandidateRevisionCarrierLimitsV1;
}>): Promise<Readonly<{
  root: string;
  rootTree: string;
  fileCount: number;
}>> {
  const limits = input.limits ?? FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1;
  const opened = await openCandidateRevisionCarrier({
    machineHome: input.machineHome,
    manifestBytes: input.manifestBytes,
    limits,
  });
  const requestedDestination = resolve(input.destination);
  const parent = await exactPrivateParent(dirname(requestedDestination));
  const destination = join(parent, basename(requestedDestination));
  if (destination === parent || basename(destination) === "." || basename(destination) === "..") {
    invalid("Candidate materialization destination is not one fresh child root");
  }
  if (await pathExists(destination)) {
    invalid("Candidate materialization destination already exists", { destination });
  }
  const staging = await mkdtemp(join(parent, `.${basename(destination)}.candidate-`));
  await chmod(staging, 0o700);
  try {
    const verificationParent = await candidateRevisionCarrierVerificationParent(input.machineHome);
    const result = await withVerifiedCandidateRevisionCarrierRepository({
      artifactPath: opened.artifactPath,
      manifest: opened.manifest,
      verificationParent,
      limits,
      operation: async (repository, closure) => {
        for (const entry of closure.treeEntries) {
          await writeBlob(repository, staging, entry, limits);
        }
        await verifyCandidateRevisionCarrierMaterialization({
          root: staging,
          objectFormat: closure.objectFormat,
          treeEntries: closure.treeEntries,
          limits,
        });
        return Object.freeze({
          rootTree: closure.rootTree,
          objectFormat: closure.objectFormat,
          fileCount: closure.treeEntries.length,
          treeEntries: closure.treeEntries,
        });
      },
    });
    if (await pathExists(destination)) {
      invalid("Candidate materialization destination appeared before publication", { destination });
    }
    try {
      await rename(staging, destination);
    } catch (error) {
      if (["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        invalid("Candidate materialization destination was substituted during publication", {
          destination,
        });
      }
      throw error;
    }
    await syncDirectory(parent);
    await verifyCandidateRevisionCarrierMaterialization({
      root: destination,
      objectFormat: result.objectFormat,
      treeEntries: result.treeEntries,
      limits,
    });
    return Object.freeze({
      root: destination,
      rootTree: result.rootTree,
      fileCount: result.fileCount,
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
