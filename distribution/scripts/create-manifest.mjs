#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertCleanSourceRevision,
  buildDistributionPackage,
  distributionRoot,
  exactExternalOutputPath,
  exactPath,
  parseNamedArguments,
} from "./lib.mjs";

const values = parseNamedArguments(process.argv.slice(2), ["--selection", "--output"]);
const selectionPath = exactPath(values.get("--selection"), "build selection");
const outputPath = exactExternalOutputPath(values.get("--output"), "manifest output");

buildDistributionPackage();
const {
  assertDistributionTemplateBytes,
  canonicalManifestBytes,
  distributionManifestDigest,
  parseDistributionBuildSelectionBytes,
} = await import("../package/dist/src/manifest.js");
await assertDistributionTemplateBytes(
  await readFile(resolve(distributionRoot, "manifests", "distribution-manifest.template.json")),
);
const manifest = parseDistributionBuildSelectionBytes(await readFile(selectionPath));
assertCleanSourceRevision(manifest.distribution.sourceRevision);
await writeFile(outputPath, canonicalManifestBytes(manifest), { flag: "wx", mode: 0o600 });
process.stdout.write(`${JSON.stringify({
  manifestDigest: distributionManifestDigest(manifest),
  output: outputPath,
})}\n`);
