#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const publicationRoot = resolve(toolDirectory, "..");
const manifestPath = resolve(publicationRoot, "publication-manifest.json");

const DOCUMENT_ROLES = new Map([
  ["GLOSSARY.md", "glossary"],
  ["IMPLEMENTATION.md", "implementation-plan"],
  ["README.md", "publication-guide"],
  ["SPEC.md", "conceptual-specification"],
  ["schemas/README.md", "schema-guide"],
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError(`Canonical JSON rejects ${typeof value}`);
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function publicationPath(path) {
  return relative(publicationRoot, path).replaceAll(sep, "/");
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(path);
    else throw new TypeError(`Publication contains a non-regular path: ${publicationPath(path)}`);
  }
  return paths;
}

function documentRole(path) {
  if (path.startsWith("spec/")) return "normative-specification";
  const role = DOCUMENT_ROLES.get(path);
  if (role === undefined) throw new TypeError(`Published document lacks an explicit role: ${path}`);
  return role;
}

async function entry(path, role, normative) {
  return {
    path: publicationPath(path),
    digest: digest(await readFile(path)),
    role,
    normative,
  };
}

async function entries(paths, classify) {
  return Promise.all(paths
    .sort((left, right) => compareText(publicationPath(left), publicationPath(right)))
    .map(async (path) => {
      const classification = classify(publicationPath(path));
      return entry(path, classification.role, classification.normative);
    }));
}

function parseArguments(arguments_) {
  if (arguments_.length === 0) return { check: false };
  if (arguments_.length === 1 && arguments_[0] === "--check") return { check: true };
  throw new TypeError("Usage: refresh-publication-manifest.mjs [--check]");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const current = JSON.parse(await readFile(manifestPath, "utf8"));
  if (current.schema !== "lifecycle.publication-manifest.v1" || current.specificationId !== "lifecycle") {
    throw new TypeError("Publication Manifest has an unsupported identity");
  }
  if (typeof current.specificationRevision !== "string" || typeof current.status !== "string") {
    throw new TypeError("Publication Manifest lacks its revision or status coordinate");
  }

  const paths = await walk(publicationRoot);
  const documents = paths.filter((path) => {
    const relativePath = publicationPath(path);
    return extname(path) === ".md"
      && !relativePath.startsWith("examples/")
      && !relativePath.startsWith("releases/");
  });
  const schemas = paths.filter((path) => {
    const relativePath = publicationPath(path);
    return extname(path) === ".json" && relativePath.startsWith("schemas/");
  });
  const fixtures = paths.filter((path) => publicationPath(path).startsWith("examples/"));

  const manifest = {
    schema: "lifecycle.publication-manifest.v1",
    specificationId: "lifecycle",
    specificationRevision: current.specificationRevision,
    status: current.status,
    documents: await entries(documents, (path) => ({
      role: documentRole(path),
      normative: path.startsWith("spec/"),
    })),
    schemas: await entries(schemas, () => ({ role: "json-schema", normative: true })),
    fixtures: await entries(fixtures, (path) => path.endsWith("provider-descriptor-codex-exec-standard-v6.json")
      ? { role: "provider-descriptor", normative: true }
      : { role: "conformance-fixture", normative: false }),
  };
  const rendered = `${JSON.stringify({
    ...manifest,
    publicationDigest: digest(Buffer.from(canonicalJson(manifest), "utf8")),
  }, null, 2)}\n`;

  if (options.check) {
    if (await readFile(manifestPath, "utf8") !== rendered) {
      throw new TypeError("Publication Manifest is stale; run npm run refresh:publication-manifest");
    }
    process.stdout.write("Publication Manifest is current.\n");
    return;
  }

  await writeFile(manifestPath, rendered, "utf8");
  process.stdout.write("Refreshed spec-source/publication-manifest.json.\n");
}

await main();
