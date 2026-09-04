import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalManifestBytes,
  createDistributionManifestFromSelection,
  distributionManifestDigest,
  parseDistributionBuildSelectionBytes,
  parseDistributionManifestBytes,
} from "../src/manifest.js";
import { distributionSelectionFixture as selection } from "./support.js";

test("build selection produces one exact canonical Distribution Manifest", () => {
  const manifest = createDistributionManifestFromSelection(selection());
  assert.equal(manifest.images.runtime.repository, "ghcr.io/neutral/lifecycle-runtime");
  assert.equal(manifest.images.execution.repository, "ghcr.io/neutral/lifecycle-execution");
  assert.equal("manifestDigest" in manifest.images.runtime.platforms[0]!, false);
  assert.equal("manifestDigest" in manifest.images.execution.platforms[0]!, false);
  assert.notEqual(
    manifest.images.execution.indexDigest,
    manifest.images.execution.platforms[0]!.configurationDigest,
  );
  assert.notEqual(
    manifest.images.execution.platforms[0]!.codexExecutableDigest,
    manifest.images.execution.platforms[1]!.codexExecutableDigest,
  );
  assert.match(distributionManifestDigest(manifest), /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(parseDistributionManifestBytes(canonicalManifestBytes(manifest)), manifest);
  assert.deepEqual(parseDistributionBuildSelectionBytes(canonicalManifestBytes(selection())), manifest);
});

test("manifest parser rejects noncanonical bytes and incomplete platform sets", () => {
  const manifest = createDistributionManifestFromSelection(selection());
  assert.throws(
    () => parseDistributionManifestBytes(Buffer.from(JSON.stringify(manifest))),
    /canonical sorted JSON/u,
  );
  const incomplete = selection();
  const images = incomplete.images as Record<string, Record<string, unknown>>;
  images.runtime!.platforms = (images.runtime!.platforms as unknown[]).slice(0, 1);
  assert.throws(() => createDistributionManifestFromSelection(incomplete), /exactly amd64 and arm64/u);

  const extraPrivateIdentity = structuredClone(manifest) as unknown as Record<string, unknown>;
  const manifestImages = extraPrivateIdentity.images as Record<string, Record<string, unknown>>;
  const runtimePlatforms = manifestImages.runtime!.platforms as Record<string, unknown>[];
  runtimePlatforms[0]!.manifestDigest = "sha256:deadbeef";
  assert.throws(
    () => parseDistributionManifestBytes(canonicalManifestBytes(extraPrivateIdentity)),
    /must have exactly architecture, configurationDigest, os, variant/u,
  );
});
