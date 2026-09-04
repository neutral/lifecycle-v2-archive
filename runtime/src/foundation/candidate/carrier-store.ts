import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { FoundationError } from "../error.js";
import { canonicalRepository } from "../repository/git.js";
import {
  compileCandidateRevisionCarrierManifest,
  parseCandidateRevisionCarrierManifest,
} from "./carrier-manifest.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  type FoundationCandidateRevisionCarrierManifestV1,
  type FoundationCandidateRevisionCarrierLimitsV1,
  type FoundationOpenedCandidateRevisionCarrierV1,
  type FoundationPreparedCandidateRevisionCarrierV1,
  type FoundationPublishedCandidateRevisionCarrierV1,
} from "./carrier-types.js";
import {
  buildCandidateRevisionCarrierPack,
  inspectCandidateRevisionCarrierClosure,
  verifyCandidateRevisionCarrierArtifact,
} from "./git-object-closure.js";

const STORE_DIRECTORY = "candidate-revision-carriers";
const STORE_VERSION = "v1";
const STAGING_DIRECTORY = "staging";
const OBJECTS_DIRECTORY = "objects";
const VERIFICATION_DIRECTORY = "verification";
const ARTIFACT_FILE = "carrier.pack";

type StorePaths = Readonly<{
  root: string;
  staging: string;
  objects: string;
  verification: string;
}>;

function invalid(message: string, observedFacts?: unknown): never {
  throw new FoundationError("lifecycle.candidate.carrier-invalid", message, {
    observedFacts,
  });
}

function unavailable(message: string, observedFacts?: unknown): never {
  throw new FoundationError("lifecycle.candidate.carrier-unavailable", message, {
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

async function exactDirectory(
  path: string,
  label: string,
  mode?: number,
): Promise<string> {
  const requested = resolve(path);
  let physical: string;
  let state: Awaited<ReturnType<typeof lstat>>;
  try {
    [physical, state] = await Promise.all([realpath(requested), lstat(requested)]);
  } catch (error) {
    invalid(`${label} is unavailable`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (
    state.isSymbolicLink() ||
    !state.isDirectory() ||
    (mode !== undefined && (state.mode & 0o7777) !== mode)
  ) {
    invalid(`${label} is not one exact private directory`, {
      expectedMode: mode,
      path: requested,
    });
  }
  const effectiveUid = process.geteuid?.() ?? process.getuid?.();
  if (effectiveUid !== undefined && state.uid !== effectiveUid) {
    invalid(`${label} is not owned by the effective runtime user`);
  }
  return physical;
}

async function ensurePrivateDirectory(path: string, label: string): Promise<string> {
  let created = false;
  try {
    await mkdir(path, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (created) {
    await chmod(path, 0o700);
    await syncDirectory(dirname(path));
  }
  return await exactDirectory(path, label, 0o700);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureStorePaths(machineHome: string): Promise<StorePaths> {
  const home = await exactDirectory(machineHome, "Lifecycle machine home");
  const store = await ensurePrivateDirectory(join(home, STORE_DIRECTORY), "Candidate Carrier Store");
  const root = await ensurePrivateDirectory(join(store, STORE_VERSION), "Candidate Carrier Store version");
  const staging = await ensurePrivateDirectory(join(root, STAGING_DIRECTORY), "Candidate Carrier staging area");
  const objects = await ensurePrivateDirectory(join(root, OBJECTS_DIRECTORY), "Candidate Carrier object area");
  const verification = await ensurePrivateDirectory(join(root, VERIFICATION_DIRECTORY), "Candidate Carrier verification area");
  return Object.freeze({ root, staging, objects, verification });
}

async function openStorePaths(machineHome: string): Promise<StorePaths> {
  const home = await exactDirectory(machineHome, "Lifecycle machine home");
  const storePath = join(home, STORE_DIRECTORY);
  if (!(await pathExists(storePath))) {
    unavailable("Candidate Carrier Store is absent");
  }
  const store = await exactDirectory(storePath, "Candidate Carrier Store", 0o700);
  const root = await exactDirectory(join(store, STORE_VERSION), "Candidate Carrier Store version", 0o700);
  const staging = await exactDirectory(join(root, STAGING_DIRECTORY), "Candidate Carrier staging area", 0o700);
  const objects = await exactDirectory(join(root, OBJECTS_DIRECTORY), "Candidate Carrier object area", 0o700);
  const verification = await exactDirectory(join(root, VERIFICATION_DIRECTORY), "Candidate Carrier verification area", 0o700);
  return Object.freeze({ root, staging, objects, verification });
}

async function exactCarrierSourceRepository(path: string): Promise<string> {
  const requested = resolve(path);
  let physical: string;
  let state: Awaited<ReturnType<typeof lstat>>;
  try {
    [physical, state] = await Promise.all([realpath(requested), lstat(requested)]);
  } catch (error) {
    invalid("Candidate Revision Carrier source repository is unavailable", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (physical !== requested || state.isSymbolicLink() || !state.isDirectory()) {
    invalid("Candidate Revision Carrier source must be one canonical physical directory", {
      physical,
      requested,
    });
  }

  let marker: Awaited<ReturnType<typeof lstat>>;
  try {
    marker = await lstat(join(requested, ".git"));
  } catch (error) {
    invalid("Candidate Revision Carrier source must be the exact Git worktree root", {
      cause: error instanceof Error ? error.message : String(error),
      requested,
    });
  }
  if (marker.isSymbolicLink() || (!marker.isDirectory() && !marker.isFile())) {
    invalid("Candidate Revision Carrier source has no exact Git worktree marker", {
      requested,
    });
  }

  let root: string;
  try {
    root = await canonicalRepository(requested);
  } catch (error) {
    invalid("Candidate Revision Carrier source is not one canonical Git worktree", {
      cause: error instanceof Error ? error.message : String(error),
      requested,
    });
  }
  if (root !== requested) {
    invalid("Candidate Revision Carrier source must equal the exact Git worktree root", {
      requested,
      root,
    });
  }
  return root;
}

function artifactLocation(paths: StorePaths, artifactDigest: string): Readonly<{
  shard: string;
  root: string;
  artifact: string;
}> {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(artifactDigest);
  if (match === null) invalid("Candidate Revision Carrier artifact digest is malformed");
  const hexadecimal = match[1]!;
  const shard = join(paths.objects, hexadecimal.slice(0, 2));
  const root = join(shard, `sha256-${hexadecimal}`);
  return Object.freeze({ shard, root, artifact: join(root, ARTIFACT_FILE) });
}

async function assertExactArtifactDirectory(path: string): Promise<void> {
  await exactDirectory(path, "Candidate Carrier artifact directory", 0o700);
  const entries = (await readdir(path)).sort();
  if (entries.length !== 1 || entries[0] !== ARTIFACT_FILE) {
    invalid("Candidate Carrier artifact directory contains an ambiguous inventory", {
      entries,
    });
  }
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

async function removeExactStagingIfPresent(input: Readonly<{
  paths: StorePaths;
  stagingRoot: string;
  artifactPath: string;
  manifest: FoundationCandidateRevisionCarrierManifestV1;
  limits: FoundationCandidateRevisionCarrierLimitsV1;
}>): Promise<void> {
  if (!(await pathExists(input.stagingRoot))) return;
  try {
    await assertExactArtifactDirectory(input.stagingRoot);
  } catch {
    // A published exact artifact is authoritative. Ambiguous staging residue
    // belongs to bounded Reclamation and must not be recursively guessed at.
    return;
  }
  if (resolve(input.artifactPath) !== join(input.stagingRoot, ARTIFACT_FILE)) return;
  await verifyCandidateRevisionCarrierArtifact({
    artifactPath: input.artifactPath,
    manifest: input.manifest,
    verificationParent: input.paths.verification,
    limits: input.limits,
  });
  await rm(input.stagingRoot, { recursive: true, force: false });
  await syncDirectory(input.paths.staging);
}

function selectedLimits(
  limits?: FoundationCandidateRevisionCarrierLimitsV1,
): FoundationCandidateRevisionCarrierLimitsV1 {
  return limits ?? FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1;
}

/**
 * Prepare and independently verify one exact Carrier under private staging.
 * This creates no Candidate Revision and grants no Process standing.
 */
export async function prepareCandidateRevisionCarrier(input: Readonly<{
  machineHome: string;
  repository: string;
  rootTree: string;
  limits?: FoundationCandidateRevisionCarrierLimitsV1;
}>): Promise<FoundationPreparedCandidateRevisionCarrierV1> {
  const limits = selectedLimits(input.limits);
  const repository = await exactCarrierSourceRepository(input.repository);
  const paths = await ensureStorePaths(input.machineHome);
  const closure = await inspectCandidateRevisionCarrierClosure({
    repository,
    rootTree: input.rootTree,
    limits,
  });
  const stagingRoot = join(paths.staging, `carrier-${randomUUID()}`);
  let ownsStaging = false;
  try {
    await mkdir(stagingRoot, { mode: 0o700 });
    ownsStaging = true;
    await chmod(stagingRoot, 0o700);
    const prepared = await buildCandidateRevisionCarrierPack({
      repository,
      stagingRoot,
      closure,
      limits,
    });
    const compiled = compileCandidateRevisionCarrierManifest({
      objectFormat: closure.objectFormat,
      rootTree: closure.rootTree,
      objectInventory: closure.objectInventory,
      carrierArtifact: prepared.artifact,
      limits,
    });
    await verifyCandidateRevisionCarrierArtifact({
      artifactPath: prepared.artifactPath,
      manifest: compiled.manifest,
      verificationParent: paths.verification,
      limits,
    });
    return Object.freeze({
      manifest: compiled.manifest,
      manifestBytes: Uint8Array.from(compiled.manifestBytes),
      stagingRoot,
      artifactPath: prepared.artifactPath,
    });
  } catch (error) {
    if (ownsStaging) {
      await rm(stagingRoot, { recursive: true, force: true });
      if (await pathExists(stagingRoot)) {
        invalid("Candidate Revision Carrier failed to remove its exact staging root", {
          stagingRoot,
        });
      }
      await syncDirectory(paths.staging);
    }
    throw error;
  }
}

/**
 * Publish one prepared immutable pack into the content-addressed Store.
 * Existing exact content is idempotent; conflicting content is never replaced.
 */
export async function publishCandidateRevisionCarrier(input: Readonly<{
  machineHome: string;
  prepared: FoundationPreparedCandidateRevisionCarrierV1;
  limits?: FoundationCandidateRevisionCarrierLimitsV1;
}>): Promise<FoundationPublishedCandidateRevisionCarrierV1> {
  const limits = selectedLimits(input.limits);
  const paths = await ensureStorePaths(input.machineHome);
  const manifestBytes = Uint8Array.from(input.prepared.manifestBytes);
  const manifest = parseCandidateRevisionCarrierManifest(manifestBytes, limits);
  if (manifest.digest !== input.prepared.manifest.digest) {
    invalid("Candidate Revision Carrier preparation manifest changed before publication");
  }
  const stagingRoot = resolve(input.prepared.stagingRoot);
  if (!within(paths.staging, stagingRoot) || dirnameDepth(paths.staging, stagingRoot) !== 1) {
    invalid("Candidate Revision Carrier preparation is outside the exact staging area");
  }
  if (resolve(input.prepared.artifactPath) !== join(stagingRoot, ARTIFACT_FILE)) {
    invalid("Candidate Revision Carrier preparation selects an unexpected artifact path");
  }
  const location = artifactLocation(paths, manifest.carrierArtifact.digest);
  await ensurePrivateDirectory(location.shard, "Candidate Carrier object shard");
  if (await pathExists(location.root)) {
    await assertExactArtifactDirectory(location.root);
    await verifyCandidateRevisionCarrierArtifact({
      artifactPath: location.artifact,
      manifest,
      verificationParent: paths.verification,
      limits,
    });
    await removeExactStagingIfPresent({
      paths,
      stagingRoot,
      artifactPath: input.prepared.artifactPath,
      manifest,
      limits,
    });
    return Object.freeze({ manifest, manifestBytes });
  }

  await assertExactArtifactDirectory(stagingRoot);
  await verifyCandidateRevisionCarrierArtifact({
    artifactPath: input.prepared.artifactPath,
    manifest,
    verificationParent: paths.verification,
    limits,
  });
  let published = false;
  try {
    await rename(stagingRoot, location.root);
    published = true;
    await syncDirectory(location.shard);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
  }

  if (!published) {
    await assertExactArtifactDirectory(location.root);
    await verifyCandidateRevisionCarrierArtifact({
      artifactPath: location.artifact,
      manifest,
      verificationParent: paths.verification,
      limits,
    });
    await removeExactStagingIfPresent({
      paths,
      stagingRoot,
      artifactPath: input.prepared.artifactPath,
      manifest,
      limits,
    });
  }
  await assertExactArtifactDirectory(location.root);
  await verifyCandidateRevisionCarrierArtifact({
    artifactPath: location.artifact,
    manifest,
    verificationParent: paths.verification,
    limits,
  });
  return Object.freeze({
    manifest,
    manifestBytes,
  });
}

function dirnameDepth(parent: string, child: string): number {
  const displacement = relative(parent, child);
  if (displacement === "") return 0;
  if (isAbsolute(displacement) || displacement === ".." || displacement.startsWith(`..${sep}`)) return -1;
  return displacement.split(sep).length;
}

/** Open and independently verify one manifest-selected immutable Carrier. */
export async function openCandidateRevisionCarrier(input: Readonly<{
  machineHome: string;
  manifestBytes: Uint8Array;
  limits?: FoundationCandidateRevisionCarrierLimitsV1;
}>): Promise<FoundationOpenedCandidateRevisionCarrierV1> {
  const limits = selectedLimits(input.limits);
  const manifestBytes = Uint8Array.from(input.manifestBytes);
  const manifest = parseCandidateRevisionCarrierManifest(manifestBytes, limits);
  const paths = await openStorePaths(input.machineHome);
  const location = artifactLocation(paths, manifest.carrierArtifact.digest);
  if (!(await pathExists(location.root))) {
    unavailable("Candidate Revision Carrier artifact is absent", {
      artifactDigest: manifest.carrierArtifact.digest,
    });
  }
  await assertExactArtifactDirectory(location.root);
  await verifyCandidateRevisionCarrierArtifact({
    artifactPath: location.artifact,
    manifest,
    verificationParent: paths.verification,
    limits,
  });
  return Object.freeze({
    manifest,
    manifestBytes,
    artifactPath: location.artifact,
  });
}

/** Private scratch parent for exact materialization verification. */
export async function candidateRevisionCarrierVerificationParent(machineHome: string): Promise<string> {
  return (await openStorePaths(machineHome)).verification;
}
