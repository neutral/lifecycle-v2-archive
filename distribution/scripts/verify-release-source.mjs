#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  assertCleanSourceRevision,
  buildDistributionPackage,
  exactPath,
  parseNamedArguments,
} from "./lib.mjs";

const values = parseNamedArguments(process.argv.slice(2), ["--manifest"]);
const manifestPath = exactPath(values.get("--manifest"), "Distribution Manifest");
buildDistributionPackage();
const { parseDistributionManifestBytes } = await import("../package/dist/src/manifest.js");
const manifest = parseDistributionManifestBytes(await readFile(manifestPath));

const head = assertCleanSourceRevision(manifest.distribution.sourceRevision);

process.stdout.write(`${JSON.stringify({ sourceRevision: head, verified: true })}\n`);
