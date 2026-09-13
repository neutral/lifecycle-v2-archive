#!/usr/bin/env node

import { createHash, createPublicKey, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir, lstat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const publicationRoot = resolve(toolDirectory, "..");
const repositoryRoot = resolve(publicationRoot, "..");
const schemasRoot = resolve(publicationRoot, "schemas");
const examplesRoot = resolve(publicationRoot, "examples");
const releasesRoot = resolve(publicationRoot, "releases");
const publicationManifestPath = resolve(publicationRoot, "publication-manifest.json");
const fixtureManifestPath = resolve(examplesRoot, "fixture-manifest.json");
const providerDescriptorPath = resolve(examplesRoot, "provider-descriptor-codex-exec-standard-v7.json");

const REQUIRED_DOCUMENTS = [
  "README.md",
  "SPEC.md",
  "GLOSSARY.md",
  "IMPLEMENTATION.md",
  "schemas/README.md",
  "spec/AUTHORITY.md",
  "spec/ATLAS.md",
  "spec/KNOWLEDGE.md",
  "spec/RELATIONSHIPS.md",
  "spec/PROCESSING.md",
  "spec/PROJECTION.md",
  "spec/ATTEMPTS.md",
  "spec/ATTEMPT_VIEW.md",
  "spec/DELIVERY.md",
  "spec/EVIDENCE.md",
  "spec/SECURITY.md",
  "spec/VALIDATION.md",
  "spec/CONFORMANCE.md",
  "spec/EVOLUTION.md",
  "spec/EXECUTION.md",
];
const REQUIRED_TOOLS = [
  "tools/check.mjs",
  "tools/refresh-fixture-manifest.mjs",
  "tools/refresh-publication-manifest.mjs",
];

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const STANDARD_SCHEMA_PREFIX = "urn:lifecycle:schema:";
const FIXTURE_MANIFEST_SCHEMA = "urn:lifecycle:schema:fixture-manifest:v1";
const PUBLICATION_MANIFEST_SCHEMA = "urn:lifecycle:schema:publication-manifest:v1";
const PUBLICATION_STATEMENT_SCHEMA = "urn:lifecycle:schema:publication-statement:v1";
const RELEASE_NOTES_SCHEMA = "urn:lifecycle:schema:release-notes:v1";
const REPOSITORY_CONTRACT_SCHEMA = "urn:lifecycle:schema:repository-contract:v22";
const PROVIDER_DESCRIPTOR_SCHEMA = "urn:lifecycle:schema:provider-descriptor:v7";
const REPOSITORY_PROFILE = "repository-contract-fixture-v9";
const STRUCTURAL_FIXTURE_PROFILES = new Map([
  ["work-delegation-payload-structural-fixture-v2", "urn:lifecycle:schema:work-delegation-payload:v2"],
  ["agent-work-product-validation-basis-structural-fixture-v1", "urn:lifecycle:schema:agent-work-product-validation-basis:v1"],
  ["builder-repair-output-structural-fixture-v1", "urn:lifecycle:schema:builder-repair-output:v1"],
  ["integration-assessment-payload-structural-fixture-v1", "urn:lifecycle:schema:integration-assessment-payload:v1"],
  ["discipline-pack-structural-fixture-v1", "urn:lifecycle:schema:discipline-pack:v1"],
  ["discipline-registry-structural-fixture-v1", "urn:lifecycle:schema:discipline-registry:v1"],
  ["knowledge-record-structural-fixture-v2", "urn:lifecycle:schema:knowledge-record:v2"],
  ["agent-attempt-payload-structural-fixture-v3", "urn:lifecycle:schema:agent-attempt-payload:v3"],
  ["agent-work-product-payload-structural-fixture-v5", "urn:lifecycle:schema:agent-work-product-payload:v5"],
  ["atlas-resolution-structural-fixture-v2", "urn:lifecycle:schema:atlas-resolution:v2"],
  ["capability-profile-structural-fixture-v2", "urn:lifecycle:schema:capability-profile:v2"],
  ["candidate-revision-carrier-manifest-structural-fixture-v1", "urn:lifecycle:schema:candidate-revision-carrier-manifest:v1"],
  ["candidate-revision-payload-structural-fixture-v3", "urn:lifecycle:schema:candidate-revision-payload:v3"],
  ["candidate-seal-payload-structural-fixture-v2", "urn:lifecycle:schema:candidate-seal-payload:v2"],
  ["check-receipt-payload-structural-fixture-v3", "urn:lifecycle:schema:check-receipt-payload:v3"],
  ["closure-payload-structural-fixture-v6", "urn:lifecycle:schema:closure-payload:v6"],
  ["control-lifecycle-profile-structural-fixture-v7", "urn:lifecycle:schema:control-lifecycle-profile:v7"],
  ["control-record-event-structural-fixture-v6", "urn:lifecycle:schema:control-record-event:v6"],
  ["control-record-file-structural-fixture-v1", "urn:lifecycle:schema:control-record-file:v1"],
  ["control-record-revision-structural-fixture-v2", "urn:lifecycle:schema:control-record-revision:v2"],
  ["control-record-store-archive-structural-fixture-v1", "urn:lifecycle:schema:control-record-store-archive:v1"],
  ["control-record-store-seal-structural-fixture-v1", "urn:lifecycle:schema:control-record-store-seal:v1"],
  ["control-record-store-structural-fixture-v2", "urn:lifecycle:schema:control-record-store:v2"],
  ["context-inspection-selector-structural-fixture-v3", "urn:lifecycle:schema:context-inspection-selector:v3"],
  ["delivery-reduction-structural-fixture-v5", "urn:lifecycle:schema:delivery-reduction:v5"],
  ["evidence-packet-payload-structural-fixture-v2", "urn:lifecycle:schema:evidence-packet-payload:v2"],
  ["execution-backend-profile-structural-fixture-v1", "urn:lifecycle:schema:execution-backend-profile:v1"],
  ["execution-image-structural-fixture-v1", "urn:lifecycle:schema:execution-image:v1"],
  ["execution-input-set-structural-fixture-v2", "urn:lifecycle:schema:execution-input-set:v2"],
  ["execution-observation-structural-fixture-v1", "urn:lifecycle:schema:execution-observation:v1"],
  ["execution-output-manifest-structural-fixture-v1", "urn:lifecycle:schema:execution-output-manifest:v1"],
  ["execution-receipt-payload-structural-fixture-v3", "urn:lifecycle:schema:execution-receipt-payload:v3"],
  ["execution-specification-structural-fixture-v1", "urn:lifecycle:schema:execution-specification:v1"],
  ["authorization-review-structural-fixture-v1", "urn:lifecycle:schema:authorization-review:v1"],
  ["director-brief-payload-structural-fixture-v2", "urn:lifecycle:schema:director-brief-payload:v2"],
  ["director-decision-payload-structural-fixture-v5", "urn:lifecycle:schema:director-decision-payload:v5"],
  ["material-condition-payload-structural-fixture-v4", "urn:lifecycle:schema:material-condition-payload:v4"],
  ["productive-semantic-operation-structural-fixture-v1", "urn:lifecycle:schema:productive-semantic-operation:v1"],
  ["projection-request-structural-fixture-v5", "urn:lifecycle:schema:projection-request:v5"],
  ["provider-descriptor-structural-fixture-v7", "urn:lifecycle:schema:provider-descriptor:v7"],
  ["work-boundary-payload-structural-fixture-v6", "urn:lifecycle:schema:work-boundary-payload:v6"],
]);
const PREDECESSOR_REPOSITORY_SCHEMAS = new Set(
  Array.from({ length: 21 }, (_, index) => `lifecycle.repository.v${index + 1}`),
);
const PREDECESSOR_CONTROL_SCHEMAS = new Set([
  "lifecycle.delivery-abandonment.v3",
  "lifecycle.delivery-acceptance.v3",
  "lifecycle.delivery-attempt.v4",
  "lifecycle.delivery-boundary-proposal.v3",
  "lifecycle.delivery-evidence.v2",
  "lifecycle.delivery-work-boundary.v3",
  "lifecycle.delivery-work-boundary.v2",
  "lifecycle.repository-contract-evolution.v1",
]);
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const CANONICAL_SPECIFICATION_ID = "lifecycle";
const RELEASE_AUTHORITY_PUBLIC_KEY = /^ed25519:[A-Za-z0-9+/=]+$/u;

function commandOptions(arguments_) {
  const options = { statementPath: null, authorityPath: null };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const next = arguments_[index + 1];
    if (argument === "--publication-statement" && next !== undefined) {
      options.statementPath = resolve(next);
      index += 1;
    } else if (argument === "--release-authority" && next !== undefined) {
      options.authorityPath = resolve(next);
      index += 1;
    } else {
      report("publication.arguments", "spec-source/tools/check.mjs", `Unsupported or incomplete argument: ${argument}`);
    }
  }
  if ((options.statementPath === null) !== (options.authorityPath === null)) {
    report("publication.arguments", "spec-source/tools/check.mjs", "--publication-statement and --release-authority must be supplied together");
  }
  return options;
}

const diagnostics = [];

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function report(code, path, message) {
  diagnostics.push({ code, path: path.replaceAll(sep, "/"), message });
}

function displayPath(path) {
  const fromRepository = relative(repositoryRoot, path).replaceAll(sep, "/");
  return fromRepository || ".";
}

function publicationPath(path) {
  return relative(publicationRoot, path).replaceAll(sep, "/");
}

function containedPath(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

async function fileKind(path) {
  try {
    const metadata = await lstat(path);
    if (metadata.isFile()) return "file";
    if (metadata.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return "missing";
    throw error;
  }
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(path);
    else report("publication.file-kind", displayPath(path), "Publication contains a non-regular file");
  }
  return paths;
}

function parseStrictJson(text, path) {
  let index = 0;
  const length = text.length;

  function fail(message) {
    throw new SyntaxError(`${message} at code-unit offset ${index}`);
  }

  function whitespace() {
    while (index < length && /[\u0009\u000a\u000d\u0020]/u.test(text[index])) index += 1;
  }

  function stringValue() {
    if (text[index] !== '"') fail("Expected a JSON string");
    const start = index;
    index += 1;
    while (index < length) {
      const unit = text.charCodeAt(index);
      if (unit === 0x22) {
        index += 1;
        const encoded = text.slice(start, index);
        try {
          const decoded = JSON.parse(encoded);
          for (let offset = 0; offset < decoded.length; offset += 1) {
            const code = decoded.charCodeAt(offset);
            if (code >= 0xd800 && code <= 0xdbff) {
              const next = decoded.charCodeAt(offset + 1);
              if (next < 0xdc00 || next > 0xdfff) fail("Unpaired high surrogate in JSON string");
              offset += 1;
            } else if (code >= 0xdc00 && code <= 0xdfff) {
              fail("Unpaired low surrogate in JSON string");
            }
          }
          return decoded;
        } catch (error) {
          if (error instanceof SyntaxError && error.message.includes("surrogate")) throw error;
          fail("Malformed JSON string");
        }
      }
      if (unit === 0x5c) {
        index += 1;
        if (index >= length) fail("Truncated JSON escape");
        if (text[index] === "u") {
          if (!/^[0-9A-Fa-f]{4}$/u.test(text.slice(index + 1, index + 5))) fail("Malformed Unicode escape");
          index += 5;
          continue;
        }
        if (!/["\\/bfnrt]/u.test(text[index])) fail("Unsupported JSON escape");
        index += 1;
        continue;
      }
      if (unit <= 0x1f) fail("Unescaped control character in JSON string");
      index += 1;
    }
    fail("Unterminated JSON string");
  }

  function numberValue() {
    const match = text.slice(index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u);
    if (!match) fail("Malformed JSON number");
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail("Non-finite JSON number");
    if (Number.isInteger(number) && !Number.isSafeInteger(number)) fail("JSON integer exceeds the safe interoperable range");
    index += match[0].length;
  }

  function literal(value) {
    if (!text.startsWith(value, index)) fail(`Expected ${value}`);
    index += value.length;
  }

  function arrayValue() {
    index += 1;
    whitespace();
    if (text[index] === "]") {
      index += 1;
      return;
    }
    while (index < length) {
      value();
      whitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      if (text[index] !== ",") fail("Expected comma or array end");
      index += 1;
      whitespace();
    }
    fail("Unterminated JSON array");
  }

  function objectValue() {
    index += 1;
    whitespace();
    const keys = new Set();
    if (text[index] === "}") {
      index += 1;
      return;
    }
    while (index < length) {
      const key = stringValue();
      if (keys.has(key)) fail(`Duplicate JSON object key ${JSON.stringify(key)}`);
      keys.add(key);
      whitespace();
      if (text[index] !== ":") fail("Expected colon after object key");
      index += 1;
      whitespace();
      value();
      whitespace();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      if (text[index] !== ",") fail("Expected comma or object end");
      index += 1;
      whitespace();
    }
    fail("Unterminated JSON object");
  }

  function value() {
    whitespace();
    const token = text[index];
    if (token === "{") objectValue();
    else if (token === "[") arrayValue();
    else if (token === '"') stringValue();
    else if (token === "t") literal("true");
    else if (token === "f") literal("false");
    else if (token === "n") literal("null");
    else numberValue();
  }

  try {
    value();
    whitespace();
    if (index !== length) fail("Trailing JSON content");
    return JSON.parse(text);
  } catch (error) {
    report("publication.json", path, error instanceof Error ? error.message : String(error));
    return undefined;
  }
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

function byteDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalDigest(value) {
  return byteDigest(Buffer.from(canonicalJson(value), "utf8"));
}

function selfDigest(value, field) {
  const subject = { ...value };
  delete subject[field];
  return canonicalDigest(subject);
}

function declaredDocumentStatus(path, text) {
  const relativePath = publicationPath(path);
  if (relativePath === "IMPLEMENTATION.md") return null;
  const pattern = /^> Status: (Outline|Draft|Accepted)$/mu;
  return text.match(pattern)?.[1] ?? undefined;
}

function expectedDisplayStatus(status) {
  return status === "outline" ? "Outline" : status === "draft" ? "Draft" : status === "accepted" ? "Accepted" : undefined;
}

function exactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort(compareText)) === canonicalJson([...keys].sort(compareText));
}

async function loadRequiredJson(path, code, label) {
  if (await fileKind(path) !== "file") {
    report(code, displayPath(path), `${label} is missing or is not a regular file`);
    return undefined;
  }
  const bytes = await readFile(path);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    report(code, displayPath(path), `${label} contains a forbidden UTF-8 byte-order mark`);
  }
  if (bytes.includes(0)) report(code, displayPath(path), `${label} contains a forbidden NUL byte`);
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").compare(bytes) !== 0) {
    report(code, displayPath(path), `${label} is not well-formed UTF-8`);
    return undefined;
  }
  return parseStrictJson(text, displayPath(path));
}

function markdownWithoutCode(text) {
  return text
    .replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/gu, "$1")
    .replace(/(?:^|\n)(?: {4}|\t).*?(?=\n(?! {4}|\t)|$)/gsu, "\n");
}

function markdownTargets(text) {
  const targets = [];
  const source = markdownWithoutCode(text);
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;
  for (const match of source.matchAll(pattern)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    const titleSeparator = target.search(/\s+["']/u);
    if (titleSeparator >= 0) target = target.slice(0, titleSeparator);
    if (target) targets.push(target);
  }
  return targets;
}

function decodedPath(target) {
  const fragment = target.indexOf("#");
  const query = target.indexOf("?");
  let end = target.length;
  if (fragment >= 0) end = Math.min(end, fragment);
  if (query >= 0) end = Math.min(end, query);
  try {
    return decodeURIComponent(target.slice(0, end));
  } catch {
    return undefined;
  }
}

async function checkMarkdown(path, text) {
  const relativePath = publicationPath(path);
  if (relativePath.startsWith("spec/") && !text.slice(0, 400).includes("Status:")) {
    report("publication.status", displayPath(path), "Normative specification document lacks an explicit Status declaration near the beginning");
  }
  for (const target of markdownTargets(text)) {
    if (target.startsWith("#") || SCHEME.test(target) || target.startsWith("//")) continue;
    const local = decodedPath(target);
    if (local === undefined) {
      report("publication.link-encoding", displayPath(path), `Markdown link has invalid percent encoding: ${target}`);
      continue;
    }
    if (!local) continue;
    if (isAbsolute(local) || WINDOWS_ABSOLUTE.test(local)) {
      report("publication.link-absolute", displayPath(path), `Local Markdown link must be repository-relative: ${target}`);
      continue;
    }
    const resolved = resolve(dirname(path), local);
    if (!containedPath(repositoryRoot, resolved)) {
      report("publication.link-escape", displayPath(path), `Markdown link escapes the repository: ${target}`);
      continue;
    }
    if (await fileKind(resolved) === "missing") report("publication.link-missing", displayPath(path), `Markdown link target does not exist: ${target}`);
  }
}

function ajvErrors(code, path, errors) {
  for (const error of [...(errors ?? [])].sort((left, right) =>
    compareText(left.instancePath, right.instancePath) ||
    compareText(left.schemaPath, right.schemaPath) ||
    compareText(left.keyword, right.keyword) ||
    compareText(left.message ?? "", right.message ?? ""))) {
    report(code, path, `${error.instancePath || "/"} ${error.message ?? error.keyword} (${error.schemaPath})`);
  }
}

function checkSortedUnique(values, code, path, label) {
  const sorted = [...values].sort(compareText);
  if (values.some((value, index) => value !== sorted[index])) report(code, path, `${label} must use ascending code-point order`);
  if (new Set(values).size !== values.length) report(code, path, `${label} contains a duplicate value`);
}

function diagnosticCatalog(text) {
  const catalog = new Map();
  const pattern = /^\| `(lifecycle\.[A-Za-z0-9._-]+)` \| (error|warning|information) \|/gmu;
  for (const match of text.matchAll(pattern)) {
    const code = match[1];
    const line = text.slice(0, match.index).split("\n").length;
    if (catalog.has(code)) {
      report("publication.diagnostic-duplicate", "spec-source/spec/VALIDATION.md", `Diagnostic ${code} is declared more than once (lines ${catalog.get(code).line} and ${line})`);
    } else {
      catalog.set(code, { severity: match[2], line });
    }
  }
  if (catalog.size === 0) report("publication.diagnostic-catalog", "spec-source/spec/VALIDATION.md", "No standard diagnostics were found");
  return catalog;
}

function standardProfiles(text) {
  return [...text.matchAll(/^### `([a-z0-9-]+-v[0-9]+)`$/gmu)].map((match) => match[1]).sort(compareText);
}

function providerDescriptorSemanticErrors(descriptor) {
  const errors = [];
  if (descriptor === null || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    return ["published Provider Descriptor is not an object"];
  }
  if (descriptor.adapter === null || typeof descriptor.adapter !== "object" || Array.isArray(descriptor.adapter)) {
    errors.push("published Provider Descriptor adapter is not an object");
  } else {
    const expectedImplementationDigest = selfDigest(descriptor.adapter, "implementationDigest");
    if (descriptor.adapter.implementationDigest !== expectedImplementationDigest) {
      errors.push(`adapter implementationDigest is ${descriptor.adapter.implementationDigest}; expected ${expectedImplementationDigest}`);
    }
  }
  const expectedDescriptorDigest = selfDigest(descriptor, "digest");
  if (descriptor.digest !== expectedDescriptorDigest) errors.push(`descriptor digest is ${descriptor.digest}; expected ${expectedDescriptorDigest}`);
  return errors;
}

function embeddedPublicationErrors(value, specificationRevision, pointer = "", rootSchema = value?.schema) {
  const errors = [];
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      errors.push(...embeddedPublicationErrors(value[index], specificationRevision, `${pointer}/${index}`, rootSchema));
    }
    return errors;
  }
  if (value === null || typeof value !== "object") return errors;
  for (const [key, child] of Object.entries(value)) {
    const childPointer = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    // A Pack binds immutable publisher provenance, not a target's selected publication.
    if (rootSchema === "lifecycle.discipline-pack.v1" && childPointer === "/contract/specificationRevision") continue;
    if (key === "specificationRevision" && typeof child === "string" && child.startsWith("lifecycle.foundation.") && child !== specificationRevision) {
      errors.push(`${childPointer} is ${JSON.stringify(child)}; expected ${JSON.stringify(specificationRevision)}`);
    }
    errors.push(...embeddedPublicationErrors(child, specificationRevision, childPointer, rootSchema));
  }
  return errors;
}

function repositorySemanticErrors(subject, specificationId, specificationRevision, documentStatus, providerDescriptor) {
  const errors = [];
  if (subject.specification?.id !== specificationId) {
    errors.push(`specification id is ${JSON.stringify(subject.specification?.id)}; expected ${JSON.stringify(specificationId)}`);
  }
  if (subject.specification?.revision !== specificationRevision) {
    errors.push(`specification revision is ${JSON.stringify(subject.specification?.revision)}; expected ${JSON.stringify(specificationRevision)}`);
  }
  if (subject.specification?.status !== documentStatus) {
    errors.push(`specification document status is ${JSON.stringify(subject.specification?.status)}; expected ${JSON.stringify(documentStatus)}`);
  }
  for (const [key, profile] of Object.entries(subject.capabilityProfiles ?? {})) {
    if (profile.id !== key) errors.push(`capability profile ${key} has id ${JSON.stringify(profile.id)}`);
    const expected = selfDigest(profile, "digest");
    if (profile.digest !== expected) errors.push(`capability profile ${key} digest is ${profile.digest}; expected ${expected}`);
  }
  for (const [key, profile] of Object.entries(subject.projectionProfiles ?? {})) {
    if (profile.id !== key) errors.push(`projection profile ${key} has id ${JSON.stringify(profile.id)}`);
    const expected = selfDigest(profile, "digest");
    if (profile.digest !== expected) errors.push(`projection profile ${key} digest is ${profile.digest}; expected ${expected}`);
  }
  for (const [key, binding] of Object.entries(subject.checkBindings ?? {})) {
    if (binding.id !== key) errors.push(`Check Binding ${key} has id ${JSON.stringify(binding.id)}`);
    const expected = selfDigest(binding, "digest");
    if (binding.digest !== expected) errors.push(`Check Binding ${key} digest is ${binding.digest}; expected ${expected}`);
  }
  if (!(subject.defaults?.capabilityProfileId in (subject.capabilityProfiles ?? {}))) errors.push("default capability profile is not registered");
  if (!(subject.defaults?.orientationProjectionProfileId in (subject.projectionProfiles ?? {}))) errors.push("default Orientation Projection profile is not registered");
  if (!(subject.defaults?.executionProjectionProfileId in (subject.projectionProfiles ?? {}))) errors.push("default Execution Projection profile is not registered");
  if (subject.defaults?.providerDescriptorId !== subject.provider?.defaultDescriptorId) errors.push("default Provider Descriptor does not match the repository provider selection");
  if (providerDescriptor === undefined) {
    errors.push("published Provider Descriptor is unavailable");
  } else {
    if (subject.provider?.defaultDescriptorId !== providerDescriptor.id) errors.push("repository provider id does not resolve to the published Provider Descriptor");
    if (subject.provider?.defaultDescriptorDigest !== providerDescriptor.digest) errors.push("repository provider digest does not resolve to the published Provider Descriptor");
    if (subject.provider?.protocol !== providerDescriptor.adapter?.protocol) errors.push("repository provider protocol does not match the published Provider Descriptor adapter");
  }
  for (const [key, binding] of Object.entries(subject.checkBindings ?? {})) {
    if (binding.capabilityProfileId !== null && !(binding.capabilityProfileId in (subject.capabilityProfiles ?? {}))) errors.push(`Check Binding ${key} capability profile is not registered`);
  }
  const expectedContractDigest = selfDigest(subject, "digest");
  if (subject.digest !== expectedContractDigest) errors.push(`repository contract digest is ${subject.digest}; expected ${expectedContractDigest}`);
  return errors;
}

async function checkFixtureManifest(
  value,
  validator,
  repositoryValidator,
  structuralValidators,
  providerDescriptor,
  catalog,
  documentStatus,
) {
  const manifestDisplay = displayPath(fixtureManifestPath);
  if (!validator(value)) ajvErrors("publication.fixture-manifest-schema", manifestDisplay, validator.errors);
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.fixtures)) return;
  const ids = new Set();
  const declaredPaths = new Set();
  for (const fixture of value.fixtures) {
    if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture)) continue;
    if (typeof fixture.id === "string") {
      if (ids.has(fixture.id)) report("publication.fixture-id", manifestDisplay, `Fixture id is duplicated: ${fixture.id}`);
      ids.add(fixture.id);
    }
    if (typeof fixture.path !== "string") continue;
    if (declaredPaths.has(fixture.path)) report("publication.fixture-path", manifestDisplay, `Fixture path is duplicated: ${fixture.path}`);
    declaredPaths.add(fixture.path);
    const directory = resolve(examplesRoot, fixture.path);
    if (!containedPath(examplesRoot, directory) || await fileKind(directory) !== "directory") {
      report("publication.fixture-path", manifestDisplay, `Fixture path does not name an existing directory under examples/: ${fixture.path}`);
      continue;
    }
    const structuralValidator = structuralValidators.get(fixture.profile);
    if (fixture.profile !== REPOSITORY_PROFILE && structuralValidator === undefined) {
      report("publication.fixture-profile", manifestDisplay, `Unsupported fixture profile ${JSON.stringify(fixture.profile)} at ${fixture.path}`);
      continue;
    }
    const required = Array.isArray(fixture.diagnostics) ? fixture.diagnostics : [];
    const allowed = Array.isArray(fixture.allowedDiagnostics) ? fixture.allowedDiagnostics : [];
    checkSortedUnique(required, "publication.fixture-diagnostics", manifestDisplay, `Fixture ${fixture.id} diagnostics`);
    checkSortedUnique(allowed, "publication.fixture-diagnostics", manifestDisplay, `Fixture ${fixture.id} allowedDiagnostics`);
    for (const code of [...required, ...allowed]) {
      if (!catalog.has(code)) report("publication.fixture-diagnostic-unknown", manifestDisplay, `Fixture ${fixture.id} references an undeclared standard diagnostic: ${code}`);
    }
    for (const code of required) {
      if (allowed.includes(code)) report("publication.fixture-diagnostics", manifestDisplay, `Fixture ${fixture.id} repeats ${code} in required and allowed diagnostics`);
    }
    if (structuralValidator !== undefined) {
      const subjectName = "subject.json";
      const subjectPath = resolve(directory, subjectName);
      if (await fileKind(subjectPath) !== "file") {
        report("publication.fixture-subject", displayPath(subjectPath), `Structural fixture lacks ${subjectName}`);
        continue;
      }
      const subjectBytes = await readFile(subjectPath);
      const observedSubjectDigest = canonicalDigest({
        profile: fixture.profile,
        entries: [{ path: subjectName, digest: byteDigest(subjectBytes) }],
      });
      if (fixture.subjectDigest !== observedSubjectDigest) report("publication.fixture-subject-digest", manifestDisplay, `Fixture ${fixture.id} subjectDigest is ${fixture.subjectDigest}; expected ${observedSubjectDigest}`);
      const subject = parseStrictJson(subjectBytes.toString("utf8"), displayPath(subjectPath));
      if (subject === undefined) continue;
      const observedDiagnostics = structuralValidator(subject) ? [] : ["lifecycle.schema.invalid"];
      const observedValid = observedDiagnostics.length === 0;
      if (fixture.valid === true) {
        for (const message of embeddedPublicationErrors(subject, value.specificationRevision)) {
          report("publication.fixture-coordinate", displayPath(subjectPath), message);
        }
      }
      if (fixture.complete !== true) report("publication.fixture-result", manifestDisplay, `Structural fixture ${fixture.id} must be complete`);
      if (fixture.valid !== observedValid) report("publication.fixture-result", manifestDisplay, `Fixture ${fixture.id} valid is ${fixture.valid}; observed ${observedValid}`);
      if (canonicalJson(required) !== canonicalJson(observedDiagnostics)) report("publication.fixture-result", manifestDisplay, `Fixture ${fixture.id} diagnostics ${canonicalJson(required)} do not equal observed ${canonicalJson(observedDiagnostics)}`);
      continue;
    }
    const subjectPath = resolve(directory, ".lifecycle/repository.json");
    if (await fileKind(subjectPath) !== "file") {
      report("publication.fixture-subject", displayPath(subjectPath), "Repository fixture lacks .lifecycle/repository.json");
      continue;
    }
    const subjectBytes = await readFile(subjectPath);
    const controlRoot = resolve(directory, "records/control");
    const controlPaths = await fileKind(controlRoot) === "directory"
      ? await walk(controlRoot)
      : [];
    const subjectEntries = [
      { path: ".lifecycle/repository.json", digest: byteDigest(subjectBytes) },
      ...await Promise.all(controlPaths.map(async (path) => ({
        path: relative(directory, path).replaceAll(sep, "/"),
        digest: byteDigest(await readFile(path)),
      }))),
    ].sort((left, right) => compareText(left.path, right.path));
    const observedSubjectDigest = canonicalDigest({ profile: REPOSITORY_PROFILE, entries: subjectEntries });
    if (fixture.subjectDigest !== observedSubjectDigest) report("publication.fixture-subject-digest", manifestDisplay, `Fixture ${fixture.id} subjectDigest is ${fixture.subjectDigest}; expected ${observedSubjectDigest}`);
    const subject = parseStrictJson(subjectBytes.toString("utf8"), displayPath(subjectPath));
    if (subject === undefined || subject === null || typeof subject !== "object" || Array.isArray(subject)) continue;
    let observedDiagnostics = [];
    if (PREDECESSOR_REPOSITORY_SCHEMAS.has(subject.$schema)) {
      observedDiagnostics = ["lifecycle.repository.predecessor-unsupported"];
    } else {
      let unsupportedControl = false;
      if (controlPaths.length > 0) {
        for (const controlPath of controlPaths) {
          if (extname(controlPath) !== ".json") continue;
          const controlBytes = await readFile(controlPath);
          const control = parseStrictJson(controlBytes.toString("utf8"), displayPath(controlPath));
          const schema = control !== null && typeof control === "object" && !Array.isArray(control)
            ? control.schema
            : undefined;
          if (typeof schema === "string" && PREDECESSOR_CONTROL_SCHEMAS.has(schema)) unsupportedControl = true;
        }
      }
      if (unsupportedControl) observedDiagnostics = ["lifecycle.repository.epoch-mixed"];
      else if (!repositoryValidator(subject)) observedDiagnostics = ["lifecycle.repository.contract-invalid"];
      else {
        const semanticErrors = repositorySemanticErrors(
          subject,
          value.specificationId,
          value.specificationRevision,
          documentStatus,
          providerDescriptor,
        );
        if (semanticErrors.length > 0) observedDiagnostics = ["lifecycle.repository.contract-invalid"];
        if (fixture.valid === true) {
          for (const message of semanticErrors) report("publication.fixture-semantic", displayPath(subjectPath), message);
        }
      }
    }
    observedDiagnostics.sort(compareText);
    const observedValid = observedDiagnostics.length === 0;
    if (fixture.complete !== true) report("publication.fixture-result", manifestDisplay, `Repository fixture ${fixture.id} must be complete`);
    if (fixture.valid !== observedValid) report("publication.fixture-result", manifestDisplay, `Fixture ${fixture.id} valid is ${fixture.valid}; observed ${observedValid}`);
    if (canonicalJson(required) !== canonicalJson(observedDiagnostics)) report("publication.fixture-result", manifestDisplay, `Fixture ${fixture.id} diagnostics ${canonicalJson(required)} do not equal observed ${canonicalJson(observedDiagnostics)}`);
  }
  const topLevel = await readdir(examplesRoot, { withFileTypes: true });
  const fixtureDirectories = topLevel.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(compareText);
  const declared = [...declaredPaths].sort(compareText);
  if (canonicalJson(fixtureDirectories) !== canonicalJson(declared)) report("publication.fixture-membership", manifestDisplay, `Fixture directory membership is ${canonicalJson(fixtureDirectories)}; manifest declares ${canonicalJson(declared)}`);
}

async function checkReleaseNotes(manifest, validator, expectedSchemaIds, expectedProfiles, fixtureManifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest) || typeof manifest.specificationRevision !== "string") return undefined;
  const path = resolve(releasesRoot, manifest.specificationRevision, "release-notes.json");
  if (!containedPath(releasesRoot, path)) {
    report("publication.release-notes-path", displayPath(path), "Specification revision does not produce a contained Release Notes path");
    return undefined;
  }
  const notes = await loadRequiredJson(path, "publication.release-notes", "Release Notes");
  if (notes === undefined) return undefined;
  if (!validator(notes)) ajvErrors("publication.release-notes-schema", displayPath(path), validator.errors);
  if (notes === null || typeof notes !== "object" || Array.isArray(notes)) return undefined;
  if (notes.specificationId !== manifest.specificationId) report("publication.release-notes-coordinate", displayPath(path), "Release Notes specificationId does not equal the Publication Manifest");
  if (notes.specificationRevision !== manifest.specificationRevision) report("publication.release-notes-coordinate", displayPath(path), "Release Notes specificationRevision does not equal the Publication Manifest");
  if (notes.publicationDigest !== manifest.publicationDigest) report("publication.release-notes-coordinate", displayPath(path), "Release Notes publicationDigest does not equal the Publication Manifest self-digest");
  if (typeof notes.specificationVersion === "string" && manifest.specificationRevision !== `lifecycle.foundation.${notes.specificationVersion}`) {
    report("publication.release-notes-coordinate", displayPath(path), "Release Notes version does not compose the exact Lifecycle Foundation revision");
  }
  if (typeof notes.digest === "string") {
    const expected = selfDigest(notes, "digest");
    if (notes.digest !== expected) report("publication.release-notes-self-digest", displayPath(path), `digest is ${notes.digest}; expected ${expected}`);
  }
  const changes = Array.isArray(notes.changes) ? notes.changes : [];
  checkSortedUnique(changes.map((change) => change?.id).filter((id) => typeof id === "string"), "publication.release-notes-order", displayPath(path), "Release Notes change identities");
  for (const change of changes) {
    if (change === null || typeof change !== "object" || Array.isArray(change)) continue;
    for (const field of ["owners", "schemas", "profiles"]) {
      if (Array.isArray(change[field])) checkSortedUnique(change[field], "publication.release-notes-order", displayPath(path), `Release Notes change ${change.id} ${field}`);
    }
  }
  if (notes.previousPublication === null) {
    const declaredSchemas = [...new Set(changes.flatMap((change) => Array.isArray(change?.schemas) ? change.schemas : []))].sort(compareText);
    const declaredProfiles = [...new Set(changes.flatMap((change) => Array.isArray(change?.profiles) ? change.profiles : []))].sort(compareText);
    const declaredOwners = [...new Set(changes.flatMap((change) => Array.isArray(change?.owners) ? change.owners : []))].sort(compareText);
    const expectedOwners = Array.isArray(manifest.documents)
      ? manifest.documents.filter((entry) => entry?.normative === true).map((entry) => entry.path).sort(compareText)
      : [];
    if (canonicalJson(declaredSchemas) !== canonicalJson(expectedSchemaIds)) report("publication.release-notes-coverage", displayPath(path), "Initial Release Notes do not name the complete published schema registry");
    if (canonicalJson(declaredProfiles) !== canonicalJson(expectedProfiles)) report("publication.release-notes-coverage", displayPath(path), "Initial Release Notes do not name every standard validation profile");
    if (canonicalJson(declaredOwners) !== canonicalJson(expectedOwners)) report("publication.release-notes-coverage", displayPath(path), "Initial Release Notes do not name every normative specification owner");
  }
  if (notes.hardCut !== null && typeof notes.hardCut === "object" && !Array.isArray(notes.hardCut) && Array.isArray(notes.hardCut.fixtureIds)) {
    checkSortedUnique(notes.hardCut.fixtureIds, "publication.release-notes-order", displayPath(path), "Release Notes hard-cut fixtureIds");
    const knownFixtureIds = new Set(Array.isArray(fixtureManifest?.fixtures) ? fixtureManifest.fixtures.map((fixture) => fixture?.id) : []);
    for (const fixtureId of notes.hardCut.fixtureIds) {
      if (!knownFixtureIds.has(fixtureId)) report("publication.release-notes-fixture", displayPath(path), `Hard-cut fixture is not declared by the Fixture Manifest: ${fixtureId}`);
    }
  }
  if (manifest.specificationRevision.includes("-rc.") && notes.hardCut?.firstAcceptedSuccessorCoordinate !== null) {
    report("publication.release-notes-status", displayPath(path), "A qualification candidate must not claim the first Accepted successor coordinate");
  }
  return { path, value: notes };
}

async function checkPublicationStatement(options, manifest, notes, validator) {
  if (options.statementPath === null || options.authorityPath === null) return;
  const statement = await loadRequiredJson(options.statementPath, "publication.statement", "Publication Statement");
  const authority = await loadRequiredJson(options.authorityPath, "publication.authority", "Trusted release-authority configuration");
  if (statement === undefined || authority === undefined) return;
  if (!validator(statement)) ajvErrors("publication.statement-schema", displayPath(options.statementPath), validator.errors);
  if (statement === null || typeof statement !== "object" || Array.isArray(statement)) return;
  if (!exactObject(authority, ["principalId", "keyId", "publicKey"])) {
    report("publication.authority", displayPath(options.authorityPath), "Trusted release-authority configuration must contain exactly principalId, keyId, and publicKey");
    return;
  }
  if (containedPath(publicationRoot, options.authorityPath)) {
    report("publication.authority", displayPath(options.authorityPath), "Trusted release-authority configuration must be selected outside the publication source tree");
  }
  const subject = statement.subject;
  const envelope = statement.authority;
  if (subject === null || typeof subject !== "object" || Array.isArray(subject) || envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) return;
  const expectedSubjectDigest = canonicalDigest(subject);
  if (statement.subjectDigest !== expectedSubjectDigest) report("publication.statement-subject-digest", displayPath(options.statementPath), `subjectDigest is ${statement.subjectDigest}; expected ${expectedSubjectDigest}`);
  const expectedStatementDigest = selfDigest(statement, "digest");
  if (statement.digest !== expectedStatementDigest) report("publication.statement-self-digest", displayPath(options.statementPath), `digest is ${statement.digest}; expected ${expectedStatementDigest}`);
  for (const [field, expected] of [
    ["specificationId", manifest.specificationId],
    ["specificationRevision", manifest.specificationRevision],
    ["publicationDigest", manifest.publicationDigest],
    ["specificationVersion", notes?.value?.specificationVersion],
  ]) {
    if (subject[field] !== expected) report("publication.statement-coordinate", displayPath(options.statementPath), `Statement ${field} is ${JSON.stringify(subject[field])}; expected ${JSON.stringify(expected)}`);
  }
  if (subject.releaseNotes?.digest !== notes?.value?.digest) report("publication.statement-coordinate", displayPath(options.statementPath), "Statement Release Notes digest does not equal the validated Release Notes");
  if (typeof subject.releaseNotes?.locator === "string" && !SCHEME.test(subject.releaseNotes.locator)) {
    const locatedNotes = resolve(dirname(options.statementPath), subject.releaseNotes.locator);
    if (locatedNotes !== notes.path) report("publication.statement-coordinate", displayPath(options.statementPath), "Statement Release Notes locator does not resolve to the validated sidecar");
  }
  if (subject.status !== "candidate" && subject.status !== "released") {
    report("publication.statement-status", displayPath(options.statementPath), "Qualification verification accepts only candidate or released statements");
  }
  if (subject.status === "released") {
    if (manifest.status !== "accepted") report("publication.statement-status", displayPath(options.statementPath), "A released statement requires Accepted document status");
    if (notes?.value?.hardCut !== null && notes?.value?.hardCut?.firstAcceptedSuccessorCoordinate === null) report("publication.statement-status", displayPath(options.statementPath), "A released hard-cut statement requires the first Accepted successor coordinate");
  }
  if (subject.status === "candidate" && notes.value.previousPublication === null && subject.previousStatementDigest !== null) {
    report("publication.statement-status", displayPath(options.statementPath), "The initial candidate statement cannot claim a prior Publication Statement");
  }
  if (String(subject.specificationRevision).toLowerCase().includes("draft")) report("publication.statement-status", displayPath(options.statementPath), "Candidate or released statement cannot bind a Draft development revision");
  if (envelope.principalId !== authority.principalId || envelope.keyId !== authority.keyId) {
    report("publication.statement-authority", displayPath(options.statementPath), "Statement principal or key identity does not equal the independently selected release authority");
  }
  if (typeof authority.publicKey !== "string" || !RELEASE_AUTHORITY_PUBLIC_KEY.test(authority.publicKey)) {
    report("publication.authority", displayPath(options.authorityPath), "Trusted release-authority publicKey must be one Ed25519 SPKI DER base64 value");
    return;
  }
  try {
    const publicKey = createPublicKey({ key: Buffer.from(authority.publicKey.slice("ed25519:".length), "base64"), type: "spki", format: "der" });
    const signature = typeof envelope.signature === "string" && envelope.signature.startsWith("ed25519:")
      ? Buffer.from(envelope.signature.slice("ed25519:".length), "base64url")
      : Buffer.alloc(0);
    if (!verify(null, Buffer.from(canonicalJson(subject), "utf8"), publicKey, signature)) {
      report("publication.statement-signature", displayPath(options.statementPath), "Publication Statement signature does not verify over the exact canonical subject");
    }
  } catch (error) {
    report("publication.statement-signature", displayPath(options.statementPath), error instanceof Error ? error.message : String(error));
  }
  try {
    const resolvedRevision = spawnSync("git", ["rev-parse", "--verify", `${subject.sourceRevision}^{commit}`], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (resolvedRevision.status !== 0 || resolvedRevision.stdout.trim() !== subject.sourceRevision) throw new TypeError("sourceRevision is not an exact available immutable commit identity");
    const manifestAtRevision = spawnSync("git", ["show", `${subject.sourceRevision}:spec-source/publication-manifest.json`], { cwd: repositoryRoot, encoding: null, stdio: ["ignore", "pipe", "pipe"] });
    const notesAtRevision = spawnSync("git", ["show", `${subject.sourceRevision}:spec-source/releases/${manifest.specificationRevision}/release-notes.json`], { cwd: repositoryRoot, encoding: null, stdio: ["ignore", "pipe", "pipe"] });
    if (manifestAtRevision.status !== 0 || !Buffer.isBuffer(manifestAtRevision.stdout) || !manifestAtRevision.stdout.equals(await readFile(publicationManifestPath))) throw new TypeError("sourceRevision does not contain the exact Publication Manifest bytes");
    if (notesAtRevision.status !== 0 || !Buffer.isBuffer(notesAtRevision.stdout) || !notesAtRevision.stdout.equals(await readFile(notes.path))) throw new TypeError("sourceRevision does not contain the exact Release Notes bytes");
  } catch (error) {
    report("publication.statement-source-revision", displayPath(options.statementPath), error instanceof Error ? error.message : String(error));
  }
}

async function checkPublicationManifest(value, validator, paths) {
  const manifestDisplay = displayPath(publicationManifestPath);
  if (!validator(value)) ajvErrors("publication.manifest-schema", manifestDisplay, validator.errors);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  if (value.specificationId !== CANONICAL_SPECIFICATION_ID) report("publication.manifest-identity", manifestDisplay, `specificationId must be ${CANONICAL_SPECIFICATION_ID}`);
  const categories = [
    ["documents", paths.filter((path) => extname(path) === ".md" && !containedPath(examplesRoot, path) && !containedPath(releasesRoot, path)).map(publicationPath)],
    ["schemas", paths.filter((path) => extname(path) === ".json" && containedPath(schemasRoot, path)).map(publicationPath)],
    ["fixtures", paths.filter((path) => containedPath(examplesRoot, path)).map(publicationPath)],
  ];
  const globalPaths = new Set();
  for (const [category, expectedUnsorted] of categories) {
    const expected = expectedUnsorted.sort(compareText);
    const entries = Array.isArray(value[category]) ? value[category] : [];
    const declared = [];
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry) || typeof entry.path !== "string") continue;
      declared.push(entry.path);
      if (globalPaths.has(entry.path)) report("publication.manifest-path-duplicate", manifestDisplay, `Manifest path occurs more than once: ${entry.path}`);
      globalPaths.add(entry.path);
      const path = resolve(publicationRoot, entry.path);
      if (!containedPath(publicationRoot, path) || await fileKind(path) !== "file") {
        report("publication.manifest-path", manifestDisplay, `Manifest path does not name an existing regular publication file: ${entry.path}`);
        continue;
      }
      const observed = byteDigest(await readFile(path));
      if (entry.digest !== observed) report("publication.manifest-digest", manifestDisplay, `${entry.path} digest is ${entry.digest}; expected ${observed}`);
      if (category === "documents") {
        const expectedNormative = entry.path.startsWith("spec/");
        if (entry.normative !== expectedNormative) report("publication.manifest-role", manifestDisplay, `${entry.path} normative is ${entry.normative}; expected ${expectedNormative}`);
        const text = await readFile(path, "utf8");
        const declared = declaredDocumentStatus(path, text);
        const expected = expectedDisplayStatus(value.status);
        if (declared === undefined) report("publication.status", displayPath(path), "Inventoried specification document lacks an exact document Status declaration");
        else if (declared !== null && declared !== expected) report("publication.status", displayPath(path), `Declared document status is ${declared}; manifest status requires ${expected}`);
      } else if (category === "schemas") {
        if (entry.role !== "json-schema" || entry.normative !== true) report("publication.manifest-role", manifestDisplay, `${entry.path} must be a normative json-schema entry`);
      } else if (entry.path.endsWith("provider-descriptor-codex-exec-standard-v7.json")) {
        if (entry.role !== "provider-descriptor" || entry.normative !== true) report("publication.manifest-role", manifestDisplay, `${entry.path} must be the normative provider-descriptor entry`);
      } else if (entry.role !== "conformance-fixture" || entry.normative !== false) {
        report("publication.manifest-role", manifestDisplay, `${entry.path} must be a nonnormative conformance-fixture entry`);
      }
    }
    checkSortedUnique(declared, "publication.manifest-order", manifestDisplay, `${category} paths`);
    if (canonicalJson([...declared].sort(compareText)) !== canonicalJson(expected)) report("publication.manifest-membership", manifestDisplay, `${category} membership is ${canonicalJson(expected)}; manifest declares ${canonicalJson([...declared].sort(compareText))}`);
  }
  if (typeof value.publicationDigest === "string") {
    const expected = selfDigest(value, "publicationDigest");
    if (value.publicationDigest !== expected) report("publication.manifest-self-digest", manifestDisplay, `publicationDigest is ${value.publicationDigest}; expected ${expected}`);
  }
}

async function main() {
  const options = commandOptions(process.argv.slice(2));
  for (const required of [...REQUIRED_DOCUMENTS, ...REQUIRED_TOOLS]) {
    const path = resolve(publicationRoot, required);
    if (await fileKind(path) !== "file") report("publication.required", displayPath(path), "Required Lifecycle specification file is missing or is not a regular file");
  }
  if (await fileKind(publicationManifestPath) !== "file") report("publication.required", displayPath(publicationManifestPath), "Publication manifest is missing or is not a regular file");
  if (await fileKind(fixtureManifestPath) !== "file") report("publication.required", displayPath(fixtureManifestPath), "Fixture manifest is missing or is not a regular file");
  const paths = await walk(publicationRoot);
  const jsonValues = new Map();
  const schemaValues = new Map();
  let markdownCount = 0;
  let jsonCount = 0;
  for (const path of paths) {
    const extension = extname(path);
    if (extension !== ".md" && extension !== ".json" && extension !== ".mjs") continue;
    const bytes = await readFile(path);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) report("publication.bom", displayPath(path), "UTF-8 byte-order mark is forbidden");
    if (bytes.includes(0)) report("publication.nul", displayPath(path), "NUL byte is forbidden");
    const text = bytes.toString("utf8");
    if (Buffer.from(text, "utf8").compare(bytes) !== 0) {
      report("publication.utf8", displayPath(path), "File is not well-formed UTF-8");
      continue;
    }
    if (extension === ".md") {
      markdownCount += 1;
      await checkMarkdown(path, text);
    } else if (extension === ".json") {
      jsonCount += 1;
      const value = parseStrictJson(text, displayPath(path));
      if (value === undefined) continue;
      jsonValues.set(path, value);
      if (containedPath(schemasRoot, path)) schemaValues.set(path, value);
    }
  }
  const schemaIds = new Map();
  for (const [path, value] of schemaValues) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      report("publication.schema-object", displayPath(path), "Schema file must contain one JSON object");
      continue;
    }
    if (value.$schema !== DRAFT_2020_12) report("publication.schema-dialect", displayPath(path), `Schema must select ${DRAFT_2020_12}`);
    if (typeof value.$id !== "string" || !value.$id.startsWith(STANDARD_SCHEMA_PREFIX)) {
      report("publication.schema-id", displayPath(path), `Schema must have an absolute ${STANDARD_SCHEMA_PREFIX} identifier`);
    } else if (schemaIds.has(value.$id)) {
      report("publication.schema-id-duplicate", displayPath(path), `Schema identifier duplicates ${displayPath(schemaIds.get(value.$id))}`);
    } else {
      schemaIds.set(value.$id, path);
    }
    if (typeof value.title !== "string" || !value.title.trim()) report("publication.schema-title", displayPath(path), "Schema must have a nonempty title");
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: true });
  addFormats(ajv, { mode: "full" });
  for (const [path, schema] of schemaValues) {
    if (!ajv.validateSchema(schema)) ajvErrors("publication.schema-meta", displayPath(path), ajv.errors);
    try {
      ajv.addSchema(schema);
    } catch (error) {
      report("publication.schema-register", displayPath(path), error instanceof Error ? error.message : String(error));
    }
  }
  for (const [id, path] of schemaIds) {
    try {
      if (ajv.getSchema(id) === undefined) report("publication.schema-compile", displayPath(path), `Schema did not compile under registered id ${id}`);
    } catch (error) {
      report("publication.schema-compile", displayPath(path), error instanceof Error ? error.message : String(error));
    }
  }
  const fixtureValidator = ajv.getSchema(FIXTURE_MANIFEST_SCHEMA);
  const publicationValidator = ajv.getSchema(PUBLICATION_MANIFEST_SCHEMA);
  const publicationStatementValidator = ajv.getSchema(PUBLICATION_STATEMENT_SCHEMA);
  const releaseNotesValidator = ajv.getSchema(RELEASE_NOTES_SCHEMA);
  const repositoryValidator = ajv.getSchema(REPOSITORY_CONTRACT_SCHEMA);
  const structuralValidators = new Map();
  for (const [profile, schemaId] of STRUCTURAL_FIXTURE_PROFILES) {
    const structuralValidator = ajv.getSchema(schemaId);
    if (structuralValidator === undefined) {
      report("publication.schema-required", "spec-source/schemas", `Structural fixture profile ${profile} schema did not compile: ${schemaId}`);
    } else {
      structuralValidators.set(profile, structuralValidator);
    }
  }
  const providerDescriptorValidator = ajv.getSchema(PROVIDER_DESCRIPTOR_SCHEMA);
  if (fixtureValidator === undefined) report("publication.schema-required", "spec-source/schemas/fixture-manifest.schema.json", "Fixture manifest schema did not compile");
  if (publicationValidator === undefined) report("publication.schema-required", "spec-source/schemas/publication-manifest.schema.json", "Publication manifest schema did not compile");
  if (publicationStatementValidator === undefined) report("publication.schema-required", "spec-source/schemas/publication-statement.schema.json", "Publication Statement schema did not compile");
  if (releaseNotesValidator === undefined) report("publication.schema-required", "spec-source/schemas/release-notes.schema.json", "Release Notes schema did not compile");
  if (repositoryValidator === undefined) report("publication.schema-required", "spec-source/schemas/repository-contract.schema.json", "Repository contract schema did not compile");
  if (providerDescriptorValidator === undefined) report("publication.schema-required", "spec-source/schemas/provider-descriptor.schema.json", "Provider Descriptor schema did not compile");
  const validationText = await readFile(resolve(publicationRoot, "spec/VALIDATION.md"), "utf8");
  const catalog = diagnosticCatalog(validationText);
  const profiles = standardProfiles(validationText);
  const fixtureManifest = jsonValues.get(fixtureManifestPath);
  const publicationManifest = jsonValues.get(publicationManifestPath);
  const providerDescriptor = jsonValues.get(providerDescriptorPath);
  if (providerDescriptor === undefined) {
    report("publication.provider-descriptor", displayPath(providerDescriptorPath), "Published Provider Descriptor is missing or invalid JSON");
  } else if (providerDescriptorValidator !== undefined) {
    if (!providerDescriptorValidator(providerDescriptor)) ajvErrors("publication.provider-descriptor-schema", displayPath(providerDescriptorPath), providerDescriptorValidator.errors);
    for (const message of providerDescriptorSemanticErrors(providerDescriptor)) report("publication.provider-descriptor-semantic", displayPath(providerDescriptorPath), message);
  }
  if (fixtureManifest !== undefined && fixtureValidator !== undefined && repositoryValidator !== undefined &&
      structuralValidators.size === STRUCTURAL_FIXTURE_PROFILES.size) {
    await checkFixtureManifest(
      fixtureManifest,
      fixtureValidator,
      repositoryValidator,
      structuralValidators,
      providerDescriptor,
      catalog,
      publicationManifest?.status,
    );
  }
  if (publicationManifest !== undefined && publicationValidator !== undefined) {
    if (fixtureManifest && publicationManifest.specificationId !== fixtureManifest.specificationId) report("publication.identity", displayPath(publicationManifestPath), "Publication and fixture manifests select different specification identifiers");
    if (fixtureManifest && publicationManifest.specificationRevision !== fixtureManifest.specificationRevision) report("publication.revision", displayPath(publicationManifestPath), "Publication and fixture manifests select different specification revisions");
    await checkPublicationManifest(publicationManifest, publicationValidator, paths);
  }
  let releaseNotes;
  if (publicationManifest !== undefined && releaseNotesValidator !== undefined) {
    releaseNotes = await checkReleaseNotes(
      publicationManifest,
      releaseNotesValidator,
      [...schemaIds.keys()].sort(compareText),
      profiles,
      fixtureManifest,
    );
  }
  if (publicationManifest !== undefined && releaseNotes !== undefined && publicationStatementValidator !== undefined) {
    await checkPublicationStatement(options, publicationManifest, releaseNotes, publicationStatementValidator);
  }
  diagnostics.sort((left, right) => compareText(left.path, right.path) || compareText(left.code, right.code) || compareText(left.message, right.message));
  if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) process.stderr.write(`${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}\n`);
    process.stderr.write(`Lifecycle specification check failed with ${diagnostics.length} diagnostic(s).\n`);
    process.exitCode = 1;
    return;
  }
  const statusProof = options.statementPath === null ? "Draft source consistent; authenticated status not requested" : "authenticated publication statement verified";
  process.stdout.write(`Lifecycle specification check passed: ${markdownCount} Markdown files, ${jsonCount} JSON files, ${schemaValues.size} Draft 2020-12 schemas, ${fixtureManifest.fixtures.length} fixtures; ${statusProof}.\n`);
}

await main();
