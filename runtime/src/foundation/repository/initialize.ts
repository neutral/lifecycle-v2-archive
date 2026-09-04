import { randomUUID } from "node:crypto";
import { chmod, lstat, readFile, readdir, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { FoundationError } from "../error.js";
import { FOUNDATION_REPOSITORY_SCHEMA } from "../constants.js";
import { resolveAtlas } from "../atlas/resolution.js";
import { digestCanonical, selfDigest, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { parseStrictJson } from "../validation/strict-json.js";
import { opaqueId } from "../validation/value.js";
import { atomicWrite, ensureDirectory } from "../support/filesystem.js";
import { createFoundationAuthority } from "./authority.js";
import {
  assertClean,
  attachedHead,
  canonicalRepository,
  exactTreeEntries,
  git,
  gitCommonDirectory,
  resolveAttachedEpoch,
  trackedEntries,
  worktreePathInventory,
} from "./git.js";
import { buildAtlasStateForSelection } from "./atlas-state.js";
import {
  createRepositoryContract,
  hasPreFoundationRepositoryDiscriminator,
  parseFoundationCheckBindingRegistry,
  writeRepositoryContract,
} from "./contract.js";
import type { FoundationCheckBinding, FoundationRepositoryContract } from "./types.js";

const RECORD_DIRECTORIES = [
  "records/behavior",
  "records/assurance",
  "records/blueprint",
  "records/checks",
] as const;

const MAXIMUM_CARRIER_BYTES = 4 * 1024 * 1024;
type ExistingContractKind = "absent" | "predecessor" | "successor";

type DirectorySnapshot = Readonly<{
  existed: boolean;
  isDirectory: boolean;
  mode: number | null;
  path: string;
}>;

type FileSnapshot = Readonly<{
  bytes: Buffer | null;
  existed: boolean;
  mode: number | null;
  path: string;
}>;

type InitializationJournal = Readonly<{
  authorityDirectories: readonly DirectorySnapshot[];
  authorityEntries: ReadonlySet<string>;
  authorityTargetDirectory: string;
  contractPath: string;
  fileSnapshots: readonly FileSnapshot[];
  repository: string;
  repositoryDirectories: readonly DirectorySnapshot[];
}>;

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

function containsOrEquals(parent: string, child: string): boolean {
  const displacement = relative(parent, child);
  return displacement === "" || (
    displacement !== ".." &&
    !displacement.startsWith(`..${sep}`) &&
    !isAbsolute(displacement)
  );
}

async function canonicalMachineHome(input: string, repository: string): Promise<string> {
  const requested = resolve(input);
  const missing: string[] = [];
  let existing = requested;
  while (!await exists(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missing.push(basename(existing));
    existing = parent;
  }

  const metadata = await lstat(existing);
  const physicalAncestor = await realpath(existing);
  const canonical = join(physicalAncestor, ...missing.reverse());
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new FoundationError(
      "lifecycle.repository.machine-home-isolation",
      "Lifecycle machine home must resolve from one canonical physical directory",
    );
  }

  const common = await gitCommonDirectory(repository);
  if (
    containsOrEquals(repository, canonical) ||
    containsOrEquals(canonical, repository) ||
    containsOrEquals(common, canonical) ||
    containsOrEquals(canonical, common)
  ) {
    throw new FoundationError(
      "lifecycle.repository.machine-home-isolation",
      "Lifecycle machine home must be physically disjoint and non-nesting from the canonical repository and Git common directory",
    );
  }
  return canonical;
}

async function directorySnapshot(path: string): Promise<DirectorySnapshot> {
  try {
    const info = await lstat(path);
    return Object.freeze({ existed: true, isDirectory: info.isDirectory(), mode: info.mode & 0o777, path });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return Object.freeze({ existed: false, isDirectory: false, mode: null, path });
    }
    throw error;
  }
}

async function fileSnapshot(path: string): Promise<FileSnapshot> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new FoundationError(
        "lifecycle.repository.initialization-carrier",
        "Initialization can preserve only an absent or regular repository carrier",
      );
    }
    return Object.freeze({ bytes: await readFile(path), existed: true, mode: info.mode & 0o777, path });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return Object.freeze({ bytes: null, existed: false, mode: null, path });
    }
    throw error;
  }
}

async function directEntries(path: string): Promise<ReadonlySet<string>> {
  try {
    return new Set(await readdir(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
}

function initializationDirectoryPaths(repository: string): readonly string[] {
  return Object.freeze([
    ".lifecycle",
    "records",
    "records/behavior",
    "records/assurance",
    "records/blueprint",
    "records/checks",
  ].map((path) => join(repository, path)));
}

async function initializationJournal(options: {
  authorityHome: string;
  contractPath: string;
  repository: string;
  targetId: string;
}): Promise<InitializationJournal> {
  const targetId = opaqueId(options.targetId, "Repository target identity");
  const authorityRoot = join(options.authorityHome, "authorities");
  const authorityTargetDirectory = join(authorityRoot, targetId);
  const authorityAncestors: string[] = [];
  let ancestor = options.authorityHome;
  while (true) {
    authorityAncestors.push(ancestor);
    if (await exists(ancestor)) break;
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  authorityAncestors.reverse();
  const authorityDirectories = await Promise.all([...new Set([
    ...authorityAncestors,
    authorityRoot,
    authorityTargetDirectory,
  ])].map(directorySnapshot));
  const authorityTarget = authorityDirectories.at(-1)!;
  if (authorityTarget.existed && !authorityTarget.isDirectory) {
    throw new FoundationError(
      "lifecycle.repository.authority-exists",
      "Fresh initialization refuses a non-directory machine authority target",
    );
  }
  const authorityEntries = await directEntries(authorityTargetDirectory);
  if (authorityEntries.size > 0) {
    throw new FoundationError(
      "lifecycle.repository.authority-exists",
      "Fresh initialization refuses to replace an existing machine authority identity",
    );
  }
  return Object.freeze({
    authorityDirectories: Object.freeze(authorityDirectories),
    authorityEntries,
    authorityTargetDirectory,
    contractPath: options.contractPath,
    fileSnapshots: Object.freeze([
      ...await Promise.all(RECORD_DIRECTORIES
        .map(async (directory) => await fileSnapshot(join(options.repository, directory, ".gitkeep")))),
    ]),
    repository: options.repository,
    repositoryDirectories: Object.freeze(await Promise.all(
      initializationDirectoryPaths(options.repository).map(directorySnapshot),
    )),
  });
}

async function rollbackInitialization(journal: InitializationJournal): Promise<readonly string[]> {
  const failures: string[] = [];
  const step = async (label: string, operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch {
      failures.push(label);
    }
  };

  await step("repository index", async () => {
    const reset = await git(journal.repository, [
      "reset", "--quiet", "HEAD", "--", ".lifecycle/repository.json", "records",
    ], { allowFailure: true });
    if (reset.exitCode !== 0) {
      const changed = await git(journal.repository, [
        "diff", "--cached", "--quiet", "--", ".lifecycle/repository.json", "records",
      ], { allowFailure: true });
      if (changed.exitCode !== 0) throw new Error("Initialization index could not be restored");
    }
  });

  await step("repository contract", async () => await rm(journal.contractPath, { force: true }));
  for (const snapshot of [...journal.fileSnapshots].reverse()) {
    await step("repository carrier", async () => {
      if (!snapshot.existed) {
        await rm(snapshot.path, { force: true });
        return;
      }
      await writeFile(snapshot.path, snapshot.bytes!, { mode: snapshot.mode! });
      await chmod(snapshot.path, snapshot.mode!);
    });
  }

  const modeMutationPaths = new Set([
    join(journal.repository, ".lifecycle"),
    ...RECORD_DIRECTORIES.map((path) => join(journal.repository, path)),
  ]);
  for (const snapshot of [...journal.repositoryDirectories].reverse()) {
    await step("repository directory", async () => {
      if (!snapshot.existed) {
        try {
          await rmdir(snapshot.path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      } else if (snapshot.isDirectory && modeMutationPaths.has(snapshot.path)) {
        await chmod(snapshot.path, snapshot.mode!);
      }
    });
  }

  await step("machine authority", async () => {
    const entries = await directEntries(journal.authorityTargetDirectory);
    for (const entry of entries) {
      if (!journal.authorityEntries.has(entry)) {
        await rm(join(journal.authorityTargetDirectory, entry), { force: true });
      }
    }
  });
  for (const snapshot of [...journal.authorityDirectories].reverse()) {
    await step("machine authority directory", async () => {
      if (!snapshot.existed) {
        try {
          await rmdir(snapshot.path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      } else if (snapshot.isDirectory && snapshot.path === journal.authorityTargetDirectory) {
        await chmod(snapshot.path, snapshot.mode!);
      }
    });
  }
  return Object.freeze(failures);
}

async function existingContractKind(path: string): Promise<ExistingContractKind> {
  if (!await exists(path)) return "absent";
  const info = await lstat(path);
  if (!info.isFile() || info.size > MAXIMUM_CARRIER_BYTES) {
    throw new FoundationError("lifecycle.repository.contract-invalid", "Existing Lifecycle repository contract is not one bounded regular file");
  }
  const value = parseStrictJson(await readFile(path, "utf8"), { source: ".lifecycle/repository.json" });
  const source = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const predecessor = hasPreFoundationRepositoryDiscriminator(source);
  const successor = source.$schema === FOUNDATION_REPOSITORY_SCHEMA;
  if (predecessor && successor) {
    throw new FoundationError(
      "lifecycle.repository.epoch-mixed",
      "Fresh Foundation initialization refuses a repository contract with mixed predecessor and Foundation discriminators",
    );
  }
  if (predecessor) return "predecessor";
  if (!successor) {
    throw new FoundationError("lifecycle.repository.contract-invalid", "Existing Lifecycle repository contract has an unsupported schema");
  }
  return "successor";
}

function controlPath(path: string): boolean {
  return path === "records/control" || path.startsWith("records/control/");
}

async function existingControlPaths(repository: string): Promise<readonly string[]> {
  const inventory = await worktreePathInventory(repository);
  return Object.freeze([...new Set([
    ...(await trackedEntries(repository)).map(({ path }) => path),
    ...inventory.modified,
    ...inventory.untracked,
    ...inventory.ignored,
  ].filter(controlPath))].sort(compareCodePoints));
}

async function refusePredecessorOrMixedState(repository: string, contractPath: string): Promise<void> {
  const [contract, control] = await Promise.all([
    existingContractKind(contractPath),
    existingControlPaths(repository),
  ]);
  if (contract === "successor" && control.length > 0) {
    throw new FoundationError(
      "lifecycle.repository.epoch-mixed",
      "Fresh repository v15 initialization refuses tracked or live records/control beside a current repository contract",
      { observedFacts: { control } },
    );
  }
  if (contract === "predecessor" || control.length > 0) {
    const predecessor = Object.freeze([
      ...(contract === "predecessor" ? [".lifecycle/repository.json"] : []),
      ...control,
    ].sort(compareCodePoints));
    throw new FoundationError(
      "lifecycle.repository.predecessor-unsupported",
      "Fresh repository v15 initialization refuses predecessor repository or tracked Control state",
      { observedFacts: { predecessor } },
    );
  }
  if (contract === "successor") {
    throw new FoundationError("lifecycle.repository.exists", "Target already contains a Foundation Lifecycle repository contract");
  }
}

async function createLayout(repository: string): Promise<void> {
  for (const directory of RECORD_DIRECTORIES) {
    const root = join(repository, directory);
    await ensureDirectory(root, 0o755);
    if ((await directEntries(root)).size === 0) {
      await atomicWrite(join(root, ".gitkeep"), "", 0o644);
    }
  }
}

async function validateAtlas(repository: string): Promise<void> {
  const [epoch, inventory] = await Promise.all([
    resolveAttachedEpoch(repository),
    worktreePathInventory(repository),
  ]);
  const treeEntries = await exactTreeEntries(repository, epoch.tree, epoch.objectFormat);
  const atlasState = buildAtlasStateForSelection("atlas", "atlas/atlas.md", treeEntries);
  const unbound = [...inventory.untracked, ...inventory.ignored]
    .filter((path) => path === "atlas" || path.startsWith("atlas/"))
    .sort(compareCodePoints);
  if (unbound.length > 0) {
    throw new FoundationError(
      "lifecycle.repository.untracked-authority",
      "Target Atlas contains untracked or ignored files",
      { observedFacts: { paths: unbound } },
    );
  }
  await resolveAtlas({
    repository,
    entrypoint: "atlas/atlas.md",
    atlasState,
    treeEntries,
  });
}

export function commandCheckBinding(options: {
  id: string;
  checkIds?: readonly string[];
  subjectSelectors: FoundationCheckBinding["subjectSelectors"];
  executable: FoundationCheckBinding["executable"];
  args?: readonly string[];
  cwd?: string;
  network?: "none" | "loopback";
  timeoutMs?: number;
  allowedModalities?: FoundationCheckBinding["allowedModalities"];
  resultParser?: FoundationCheckBinding["resultParser"]["id"];
  limitations?: readonly string[];
}): FoundationCheckBinding {
  const implementationDigest = digestCanonical({ executable: options.executable, args: options.args ?? [] });
  const base = {
    id: options.id,
    checkIds: [...(options.checkIds ?? [])].sort(compareCodePoints),
    subjectSelectors: [...options.subjectSelectors].sort((left, right) =>
      compareCodePoints(`${left.kind}\0${left.selector}`, `${right.kind}\0${right.selector}`)),
    kind: "command" as const,
    executable: options.executable,
    args: [...(options.args ?? [])],
    cwd: options.cwd ?? ".",
    network: options.network ?? "none",
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
    allowedModalities: [...(options.allowedModalities ?? ["precondition", "repair-target", "regression-guard", "postcondition", "diagnostic"])].sort(compareCodePoints) as FoundationCheckBinding["allowedModalities"],
    capabilityProfileId: null,
    environment: {},
    resultParser: {
      id: options.resultParser ?? "exit-code-v1",
      stateModel: "check-disposition-v2" as const,
      states: ["pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error"] as const,
    },
    mutation: "forbidden" as const,
    implementationDigest,
    limitations: [...(options.limitations ?? [])].sort(compareCodePoints),
    digest: `sha256:${"0".repeat(64)}` as Sha256,
  };
  return Object.freeze({ ...base, digest: selfDigest(base) });
}

export async function initializeRepository(path: string, options: {
  targetId?: string;
  founderPrincipal?: string;
  home: string;
  authoritySecret: string;
  publicationDigest: Sha256;
  implementationRoots?: readonly string[];
  checkBindings?: Readonly<Record<string, FoundationCheckBinding>>;
  stage?: boolean;
}): Promise<FoundationRepositoryContract> {
  const repository = await canonicalRepository(path);
  const contractPath = join(repository, ".lifecycle", "repository.json");
  await refusePredecessorOrMixedState(repository, contractPath);
  await validateAtlas(repository);
  await assertClean(repository);
  const head = await attachedHead(repository);
  const checkBindings = parseFoundationCheckBindingRegistry(options.checkBindings ?? {});
  const targetId = options.targetId ?? randomUUID();
  const authorityHome = await canonicalMachineHome(options.home, repository);
  const journal = await initializationJournal({ authorityHome, contractPath, repository, targetId });
  try {
    const authority = await createFoundationAuthority(authorityHome, targetId, options.authoritySecret, options.founderPrincipal ?? "founder");
    const contract = createRepositoryContract({
      targetId,
      canonicalBranch: head.branch,
      authority,
      publicationDigest: options.publicationDigest,
      implementationRoots: options.implementationRoots,
      checkBindings,
    });
    await writeRepositoryContract(repository, contract);
    await createLayout(repository);
    const ignored = await git(repository, ["check-ignore", "--no-index", "--quiet", "--", ".lifecycle/repository.json"], { allowFailure: true });
    if (ignored.exitCode === 0) throw new FoundationError("lifecycle.repository.contract-ignored", "Existing ignore rules hide .lifecycle/repository.json");
    if (ignored.exitCode !== 1) throw new FoundationError("lifecycle.repository.ignore-check", "Repository ignore state could not be verified");
    if (options.stage !== false) await git(repository, ["add", "--", ".lifecycle/repository.json", "records"]);
    return contract;
  } catch (error) {
    const rollbackFailures = await rollbackInitialization(journal);
    if (rollbackFailures.length > 0) {
      throw new FoundationError(
        "lifecycle.repository.initialization-recovery",
        "Fresh initialization failed and could not restore every exact pre-initialization effect",
        {
          operationalStateChanged: true,
          repositoryChanged: true,
          observedFacts: {
            failureCode: error instanceof FoundationError ? error.code : "lifecycle.repository.initialization-failed",
            rollbackFailures,
          },
        },
      );
    }
    throw error;
  }
}
