#!/usr/bin/env node

import { exactPath, parseNamedArguments } from "./lib.mjs";
import { packDistributionArtifact } from "./package-artifact.mjs";

const values = parseNamedArguments(process.argv.slice(2), ["--manifest", "--destination"]);
const result = await packDistributionArtifact({
  destination: exactPath(values.get("--destination"), "package destination", false),
  manifestPath: exactPath(values.get("--manifest"), "Distribution Manifest"),
  qualificationOnly: false,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
