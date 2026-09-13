#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  buildDistributionPackage,
  distributionRoot,
  exactPath,
  parseNamedArguments,
  repositoryRoot,
  run,
} from "./lib.mjs";

const values = parseNamedArguments(process.argv.slice(2), ["--manifest"]);
const manifestPath = exactPath(values.get("--manifest"), "Distribution Manifest");
buildDistributionPackage();
run("npm", ["run", "check:self", "--workspace", "@neutral/lifecycle"], { stdio: "inherit" });
run("npm", ["run", "test:built", "--workspace", "@neutral/lifecycle"], { stdio: "inherit" });
const {
  assertDistributionTemplateBytes,
  distributionManifestDigest,
  parseDistributionManifestBytes,
} = await import("../package/dist/src/manifest.js");
await assertDistributionTemplateBytes(
  await readFile(resolve(distributionRoot, "manifests", "distribution-manifest.template.json")),
);
const schemaBytes = await readFile(
  resolve(distributionRoot, "manifests", "distribution-manifest.schema.json"),
);
const schema = JSON.parse(schemaBytes.toString("utf8"));
const selectionSchemaBytes = await readFile(
  resolve(distributionRoot, "manifests", "distribution-build-selection.schema.json"),
);
const selectionSchema = JSON.parse(selectionSchemaBytes.toString("utf8"));
const manifestBytes = await readFile(manifestPath);
const manifestValue = JSON.parse(manifestBytes.toString("utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.compile(selectionSchema);
const validate = ajv.compile(schema);
if (!validate(manifestValue)) {
  throw new TypeError(`Distribution Manifest fails its JSON Schema: ${JSON.stringify(validate.errors)}`);
}
const manifest = parseDistributionManifestBytes(manifestBytes);
const dockerfile = await readFile(resolve(distributionRoot, "runtime-image", "Dockerfile"), "utf8");
for (const required of [
  "LIFECYCLE_CA_CERTIFICATES_VERSION",
  "LIFECYCLE_GIT_VERSION",
  "LIFECYCLE_UTIL_LINUX_VERSION",
  "lifecycle.runtime-invocation.private.v1",
  "/usr/bin/docker",
  "/usr/bin/flock",
  "/usr/bin/git",
  "third-party/atlas-reference-validator/PROVENANCE.json",
  "third-party/atlas-reference-validator/LICENSE",
  "verify-tool-versions.mjs --build",
  "verify-tool-versions.mjs --runtime",
]) {
  if (!dockerfile.includes(required)) throw new TypeError(`Runtime Image omits ${required}`);
}
const dockerignore = await readFile(resolve(repositoryRoot, ".dockerignore"), "utf8");
for (const required of [
  "!third-party/atlas-reference-validator/PROVENANCE.json",
  "!third-party/atlas-reference-validator/LICENSE",
]) {
  if (!dockerignore.split("\n").includes(required)) {
    throw new TypeError(`Runtime Image context omits ${required.slice(1)}`);
  }
}
const executionDockerfile = await readFile(
  resolve(repositoryRoot, "runtime", "execution-image", "Dockerfile.agent-cell"),
  "utf8",
);
for (const required of [
  "AS runner-build",
  "npm ci --ignore-scripts",
  "src/util/execution-cell-runner-v1.ts",
  "execution-image/package-lock.json",
  "execution-image/tool-inventory.mjs",
  "tool-inventory.mjs verify",
  "AS runtime-build",
  "npm pack --workspace @neutral/lifecycle-runtime",
  "/opt/lifecycle/runtime-package.tgz",
  "/opt/lifecycle-runtime/package/dist/src/foundation/draft/cli.js",
  'test "$(node --version)" = "v24.14.0"',
]) {
  if (!executionDockerfile.includes(required)) {
    throw new TypeError(`Execution Image build omits ${required}`);
  }
}
for (const forbidden of ["COPY dist/", "npm install --global"]) {
  if (executionDockerfile.includes(forbidden)) {
    throw new TypeError(`Execution Image build consumes a forbidden ambient input: ${forbidden}`);
  }
}
const executionDockerignore = await readFile(resolve(repositoryRoot, "runtime", "execution-image", "Dockerfile.agent-cell.dockerignore"), "utf8");
for (const required of [
  "!package-lock.json",
  "!protocol/**",
  "!runtime/**",
  "!third-party/atlas-reference-validator/package/**",
  "**/node_modules/",
  "**/dist/",
  "**/*.tgz",
]) {
  if (!executionDockerignore.split("\n").includes(required)) {
    throw new TypeError(`Execution Image context omits ${required.slice(1)}`);
  }
}
if (executionDockerignore.split("\n").includes("!clients/**") || executionDockerignore.split("\n").includes("!distribution/**")) {
  throw new TypeError("Execution Image context admits interface or launcher source outside the Runtime package");
}
const executionBuilder = await readFile(
  resolve(distributionRoot, "scripts", "build-execution-image.mjs"),
  "utf8",
);
if (executionBuilder.includes('"build:self"') ||
    !executionBuilder.includes('"--provenance=false"') ||
    !executionBuilder.includes('"--sbom=false"')) {
  throw new TypeError("Execution Image builder does not preserve its exact-source build boundary");
}
const packageMetadata = JSON.parse(
  await readFile(resolve(distributionRoot, "package", "package.json"), "utf8"),
);
if ("postinstall" in (packageMetadata.scripts ?? {})) {
  throw new TypeError("@neutral/lifecycle must not have a postinstall effect");
}
if (packageMetadata.repository?.type !== "git" ||
    packageMetadata.repository?.url !== "https://github.com/neutral/lifecycle-v2-archive.git" ||
    packageMetadata.repository?.directory !== "distribution/package") {
  throw new TypeError("@neutral/lifecycle repository metadata does not select its exact GitHub source");
}
process.stdout.write(`${JSON.stringify({
  manifestDigest: distributionManifestDigest(manifest),
  schemaDigest: `sha256:${createHash("sha256").update(schemaBytes).digest("hex")}`,
  verified: true,
})}\n`);
