import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const distributionRoot = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));
export const repositoryRoot = realpathSync(resolve(distributionRoot, ".."));

const GIT = "/usr/bin/git";
const GIT_CONFIGURATION_ARGUMENTS = Object.freeze([
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "core.attributesFile=/dev/null",
  "-c", "core.pager=",
]);
const CLOSED_GIT_ENVIRONMENT = Object.freeze({
  GIT_ATTR_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_LFS_SKIP_SMUDGE: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  HOME: "/nonexistent",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
});

export function fail(message) {
  throw new TypeError(`Lifecycle distribution build failed: ${message}`);
}

export function parseNamedArguments(arguments_, names) {
  const allowed = new Set(names);
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 1) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(name) || value === undefined || value.length === 0 || value.startsWith("--") ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(value) || values.has(name)) {
      fail(`expected each of ${names.join(", ")} exactly once`);
    }
    values.set(name, value);
    index += 1;
  }
  for (const name of names) if (!values.has(name)) fail(`missing ${name}`);
  return values;
}

export function exactPath(value, label, mustExist = true) {
  const path = resolve(value);
  if (!isAbsolute(path) || normalize(path) !== path || path === parse(path).root ||
      path.endsWith(sep) || /[\u0000-\u001f\u007f-\u009f]/u.test(path)) {
    fail(`${label} is not one normalized non-root path`);
  }
  if (mustExist) {
    try {
      if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink()) throw new Error();
    } catch {
      fail(`${label} is not one canonical physical path`);
    }
  }
  return path;
}

function within(parent, child) {
  const displacement = relative(parent, child);
  return displacement === "" || (
    displacement !== ".." && !displacement.startsWith(`..${sep}`) && !isAbsolute(displacement)
  );
}

/**
 * Resolve a path that may not exist without permitting a symbolic existing
 * ancestor to redirect the eventual create. Every existing prefix must already
 * be canonical, and the nearest existing prefix must be a directory when new
 * path components remain.
 */
export function exactProspectivePath(value, label) {
  const path = exactPath(value, label, false);
  let existing = path;
  for (;;) {
    try {
      const state = lstatSync(existing);
      if (state.isSymbolicLink() || realpathSync(existing) !== existing) {
        fail(`${label} has a non-canonical or symbolic existing path`);
      }
      if (existing !== path && !state.isDirectory()) {
        fail(`${label} has a non-directory existing parent`);
      }
      return path;
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error?.code !== "ENOENT") fail(`${label} cannot be resolved without mutation`);
      const parent = dirname(existing);
      if (parent === existing) fail(`${label} has no canonical existing parent`);
      existing = parent;
    }
  }
}

export function exactExternalOutputPath(value, label) {
  const path = exactProspectivePath(value, label);
  if (within(repositoryRoot, path)) {
    fail(`${label} must be written outside the Lifecycle source checkout`);
  }
  return path;
}

export function ensureEmptyDirectory(value, label) {
  const path = exactProspectivePath(value, label);
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const state = lstatSync(path);
  if (!state.isDirectory() || state.isSymbolicLink() || realpathSync(path) !== path) {
    fail(`${label} is not one canonical physical directory`);
  }
  return path;
}

export function run(executable, arguments_, options = {}) {
  const result = spawnSync(executable, arguments_, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    stdio: options.stdio ?? "pipe",
  });
  if (result.status !== 0 || result.signal !== null) {
    const detail = typeof result.stderr === "string" ? result.stderr.trim().slice(0, 8_192) : "";
    fail(`${executable} ${arguments_[0] ?? ""} failed${detail.length === 0 ? "" : `: ${detail}`}`);
  }
  return result;
}

export function buildDistributionPackage() {
  run("npm", ["run", "build:self", "--workspace", "@neutral/lifecycle"], { stdio: "inherit" });
}

function git(arguments_, options = {}) {
  return run(GIT, [...GIT_CONFIGURATION_ARGUMENTS, ...arguments_], {
    ...options,
    env: CLOSED_GIT_ENVIRONMENT,
  });
}

export function assertCleanSourceRevision(sourceRevision) {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(sourceRevision)) {
    fail("release source revision is not one full lowercase Git object identity");
  }
  const topLevel = git(["rev-parse", "--show-toplevel"]).stdout.trim();
  if (topLevel !== repositoryRoot) fail("release source is not the Lifecycle repository root");
  const head = git(["rev-parse", "--verify", "HEAD^{commit}"]).stdout.trim();
  if (head !== sourceRevision) fail("selected source revision is not the exact checked-out commit");
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]).stdout;
  if (status.length !== 0) fail("release source contains tracked or untracked changes");
  return head;
}

export async function withExactSourceSnapshot(sourceRevision, useSnapshot) {
  assertCleanSourceRevision(sourceRevision);
  if (typeof useSnapshot !== "function") fail("exact source snapshot requires one bounded operation");
  const allocation = realpathSync(mkdtempSync(join(tmpdir(), "lifecycle-release-source-")));
  const template = join(allocation, "empty-git-template");
  const snapshot = join(allocation, "source");
  mkdirSync(template, { mode: 0o700 });
  try {
    git([
      "clone",
      "--quiet",
      "--no-checkout",
      "--no-local",
      "--no-tags",
      `--template=${template}`,
      "--",
      repositoryRoot,
      snapshot,
    ], { cwd: allocation });
    git(["-C", snapshot, "checkout", "--quiet", "--detach", sourceRevision], { cwd: allocation });
    const head = git(["-C", snapshot, "rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: allocation,
    }).stdout.trim();
    const status = git(["-C", snapshot, "status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: allocation,
    }).stdout;
    if (head !== sourceRevision || status.length !== 0 || realpathSync(snapshot) !== snapshot) {
      fail("detached release source does not exactly materialize the selected commit");
    }
    const result = await useSnapshot(snapshot);
    const retainedHead = git(["-C", snapshot, "rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: allocation,
    }).stdout.trim();
    const retainedStatus = git([
      "-C", snapshot, "status", "--porcelain=v1", "--untracked-files=all",
    ], { cwd: allocation }).stdout;
    if (retainedHead !== sourceRevision || retainedStatus.length !== 0) {
      fail("release build changed its detached exact source snapshot");
    }
    return result;
  } finally {
    rmSync(allocation, { force: true, recursive: true });
  }
}
