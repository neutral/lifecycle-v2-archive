#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const examplesRoot = resolve(toolDirectory, "../examples");
const manifestPath = resolve(examplesRoot, "fixture-manifest.json");
const REPOSITORY_PROFILE = "repository-contract-fixture-v7";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError("Canonical JSON rejects non-interoperable numbers");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => {
      if (value[key] === undefined) throw new TypeError("Canonical JSON rejects undefined");
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    }).join(",")}}`;
  }
  throw new TypeError(`Canonical JSON rejects ${typeof value}`);
}

function byteDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalDigest(value) {
  return byteDigest(Buffer.from(canonicalJson(value), "utf8"));
}

function fixturePath(path) {
  return relative(examplesRoot, path).replaceAll(sep, "/");
}

function contained(path) {
  const selected = relative(examplesRoot, path);
  return selected !== "" && selected !== ".." && !selected.startsWith(`..${sep}`) && !selected.startsWith(sep);
}

async function kind(path) {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new TypeError(`Fixture input is a symbolic link: ${fixturePath(path)}`);
    if (metadata.isFile()) return "file";
    if (metadata.isDirectory()) return "directory";
    throw new TypeError(`Fixture input is not a regular file or directory: ${fixturePath(path)}`);
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

async function walk(root) {
  if (await kind(root) === "missing") return [];
  if (await kind(root) !== "directory") throw new TypeError(`Fixture inventory root is not a directory: ${fixturePath(root)}`);
  const paths = [];
  for (const entry of (await readdir(root)).sort(compareText)) {
    const path = resolve(root, entry);
    const entryKind = await kind(path);
    if (entryKind === "directory") paths.push(...await walk(path));
    else if (entryKind === "file") paths.push(path);
  }
  return paths;
}

async function repositorySubjectDigest(directory, profile) {
  const contractPath = resolve(directory, ".lifecycle/repository.json");
  if (await kind(contractPath) !== "file") {
    throw new TypeError(`Repository fixture lacks .lifecycle/repository.json: ${fixturePath(directory)}`);
  }
  const controlPaths = await walk(resolve(directory, "records/control"));
  const entries = [
    { path: ".lifecycle/repository.json", digest: byteDigest(await readFile(contractPath)) },
    ...await Promise.all(controlPaths.map(async (path) => ({
      path: relative(directory, path).replaceAll(sep, "/"),
      digest: byteDigest(await readFile(path)),
    }))),
  ].sort((left, right) => compareText(left.path, right.path));
  return canonicalDigest({ profile, entries });
}

async function structuralSubjectDigest(directory, profile) {
  const jsonPath = resolve(directory, "subject.json");
  if (await kind(jsonPath) !== "file") {
    throw new TypeError(`Structural fixture must contain subject.json: ${fixturePath(directory)}`);
  }
  return canonicalDigest({
    profile,
    entries: [{ path: "subject.json", digest: byteDigest(await readFile(jsonPath)) }],
  });
}

function parseArguments(arguments_) {
  if (arguments_.length === 0) return { check: false };
  if (arguments_.length === 1 && arguments_[0] === "--check") return { check: true };
  throw new TypeError("Usage: refresh-fixture-manifest.mjs [--check]");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const source = await readFile(manifestPath, "utf8");
  const current = JSON.parse(source);
  if (current.schema !== "lifecycle.fixture-manifest.v1" || current.specificationId !== "lifecycle" ||
      typeof current.specificationRevision !== "string" || !Array.isArray(current.fixtures)) {
    throw new TypeError("Fixture Manifest has an unsupported identity or shape");
  }

  const fixtures = [];
  for (const fixture of current.fixtures) {
    if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture) ||
        typeof fixture.path !== "string" || typeof fixture.profile !== "string") {
      throw new TypeError("Fixture Manifest contains an invalid fixture entry");
    }
    const directory = resolve(examplesRoot, fixture.path);
    if (!contained(directory) || await kind(directory) !== "directory") {
      throw new TypeError(`Fixture path does not name a contained directory: ${fixture.path}`);
    }
    const subjectDigest = fixture.profile === REPOSITORY_PROFILE
      ? await repositorySubjectDigest(directory, fixture.profile)
      : await structuralSubjectDigest(directory, fixture.profile);
    fixtures.push({ ...fixture, subjectDigest });
  }

  const rendered = `${JSON.stringify({ ...current, fixtures }, null, 2)}\n`;
  if (options.check) {
    if (source !== rendered) {
      throw new TypeError("Fixture Manifest is stale; run npm run refresh:fixture-manifest");
    }
    process.stdout.write("Fixture Manifest is current.\n");
    return;
  }
  await writeFile(manifestPath, rendered, "utf8");
  process.stdout.write("Refreshed spec-source/examples/fixture-manifest.json.\n");
}

await main();
