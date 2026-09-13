import { lstat, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { FoundationError } from "../error.js";
import { git } from "./git.js";

function fail(path: string): never {
  throw new FoundationError(
    "lifecycle.repository.physical",
    "Lifecycle requires an independent repository with local Git metadata and no linked worktree or alternate object store",
    { observedFacts: { path } },
  );
}

async function localEntry(
  repository: string,
  path: string,
  kind: "directory" | "file",
  required = false,
): Promise<void> {
  const absolute = join(repository, path);
  try {
    const state = await lstat(absolute);
    if (state.isSymbolicLink() ||
        (kind === "directory" ? !state.isDirectory() : !state.isFile() || state.nlink !== 1) ||
        await realpath(absolute) !== absolute) fail(path);
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (error instanceof FoundationError) throw error;
    fail(path);
  }
}

async function absentEntry(repository: string, path: string): Promise<void> {
  try {
    await lstat(join(repository, path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    fail(path);
  }
  fail(path);
}

/**
 * This is a Lifecycle target/workspace boundary, not a restriction on the
 * generic Git source-reader. Inspect the metadata roots and selected ref that
 * Git consumes; do not walk or reinterpret the repository's entire history.
 * Runtime-created repositories independently import objects by construction.
 */
export async function assertIndependentGitRepository(
  repository: string,
  selectedReferences: readonly string[] = [],
): Promise<void> {
  await localEntry(repository, ".git", "directory", true);
  for (const path of [
    ".git/objects", ".git/objects/info", ".git/objects/pack",
    ".git/refs", ".git/refs/heads", ".git/refs/tags", ".git/reftable", ".git/info",
    ".git/logs", ".git/logs/refs", ".git/logs/refs/heads",
    ".git/worktrees",
  ]) await localEntry(repository, path, "directory");
  try {
    const directory = await opendir(join(repository, ".git/worktrees"));
    try { if (await directory.read() !== null) fail(".git/worktrees"); }
    finally { await directory.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof FoundationError) throw error;
      fail(".git/worktrees");
    }
  }
  for (const path of [
    ".git/commondir",
    ".git/objects/info/alternates",
    ".git/objects/info/http-alternates",
  ]) await absentEntry(repository, path);
  for (const path of [".git/HEAD", ".git/config", ".git/index", ".git/packed-refs", ".git/shallow", ".git/info/grafts"]) {
    await localEntry(repository, path, "file");
  }

  const directory = join(repository, ".git");
  const [gitDirectory, commonDirectory] = await Promise.all([
    git(repository, ["rev-parse", "--path-format=absolute", "--git-dir"]),
    git(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ]);
  if (gitDirectory.stdout.trim() !== directory || commonDirectory.stdout.trim() !== directory) fail(".git");
  const inspected = new Set<string>();
  for (const selected of ["HEAD", ...selectedReferences]) {
    let reference = selected;
    const chain = new Set<string>();
    while (!inspected.has(reference)) {
      if (chain.has(reference) || chain.size >= 64) fail(".git/HEAD");
      chain.add(reference);
      if (reference !== "HEAD") {
        const segments = reference.split("/");
        if (!reference.startsWith("refs/") || segments.some((segment) => segment === "" || segment === "." || segment === "..")) fail(".git/HEAD");
        for (let index = 1; index <= segments.length; index += 1) {
          await localEntry(repository, `.git/${segments.slice(0, index).join("/")}`,
            index === segments.length ? "file" : "directory");
          await localEntry(repository, `.git/logs/${segments.slice(0, index).join("/")}`,
            index === segments.length ? "file" : "directory");
        }
      }
      // Follow one symbolic edge only: resolving straight to the final ref
      // would skip intermediate mutable files consumed by Git.
      const next = await git(repository, ["symbolic-ref", "--no-recurse", "--quiet", reference], { allowFailure: true });
      if (next.exitCode === 1) break;
      if (next.exitCode !== 0) fail(".git/HEAD");
      reference = next.stdout.trim();
    }
    for (const item of chain) inspected.add(item);
  }
}
