#!/usr/bin/env node

process.stderr.write(
  "Refusing to pack @neutral/lifecycle without an exact Distribution Manifest. " +
  "Use distribution/scripts/pack-distribution.mjs --manifest <path> --destination <empty-directory>.\n",
);
process.exit(1);
