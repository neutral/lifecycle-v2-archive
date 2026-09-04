import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildDistributionPackage,
  ensureEmptyDirectory,
  exactExternalOutputPath,
  fail,
  repositoryRoot,
  run,
  withExactSourceSnapshot,
} from "./lib.mjs";

export function assertExternalArtifactDestination(destination) {
  return exactExternalOutputPath(destination, "package artifacts");
}

/**
 * Stage the exact public package inventory. Qualification uses the same
 * launcher and manifest bytes but an unpublishable package identity and a
 * visibly non-release filename.
 */
export async function packDistributionArtifact({ destination, manifestPath, qualificationOnly }) {
  const externalDestination = assertExternalArtifactDestination(destination);
  const manifestBytes = await readFile(manifestPath);
  let selectedSourceRevision;
  try {
    selectedSourceRevision = JSON.parse(manifestBytes.toString("utf8"))?.distribution?.sourceRevision;
  } catch {
    fail("Distribution Manifest is not JSON");
  }
  if (typeof selectedSourceRevision !== "string" ||
      !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(selectedSourceRevision)) {
    fail("Distribution Manifest does not select one full source revision");
  }

  const packFromSource = async (sourceRoot) => {
    const selectedDestination = ensureEmptyDirectory(
      externalDestination,
      qualificationOnly ? "qualification package destination" : "package destination",
    );
    if ((await readdir(selectedDestination)).length !== 0) fail("package destination must be empty");
    if (qualificationOnly) {
      buildDistributionPackage();
    } else {
      run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
        cwd: sourceRoot,
        stdio: "inherit",
      });
      run("npm", ["run", "build:self", "--workspace", "@neutral/lifecycle"], {
        cwd: sourceRoot,
        stdio: "inherit",
      });
    }
    const sourcePackage = resolve(sourceRoot, "distribution", "package");
    const {
      distributionManifestDigest,
      parseDistributionManifestBytes,
    } = await import(pathToFileURL(resolve(sourcePackage, "dist", "src", "manifest.js")).href);
    const manifest = parseDistributionManifestBytes(manifestBytes);
    if (!qualificationOnly && manifest.distribution.sourceRevision !== selectedSourceRevision) {
      fail("Distribution Manifest source revision changed while parsed");
    }

    const stage = await mkdtemp(join(tmpdir(), "lifecycle-distribution-package-"));
    try {
      await Promise.all([
        cp(resolve(sourcePackage, "README.md"), resolve(stage, "README.md")),
        cp(resolve(sourcePackage, "bin"), resolve(stage, "bin"), { recursive: true }),
        cp(resolve(sourcePackage, "dist", "src"), resolve(stage, "dist", "src"), { recursive: true }),
      ]);
      await mkdir(resolve(stage, "manifest"), { mode: 0o700 });
      const stagedManifestPath = resolve(stage, "manifest", "distribution-manifest.json");
      await writeFile(stagedManifestPath, manifestBytes, { mode: 0o644 });
      const stagedManifestBytes = await readFile(stagedManifestPath);
      if (!stagedManifestBytes.equals(manifestBytes)) {
        fail("staged Distribution Manifest bytes changed while packaging");
      }
      await writeFile(
        resolve(stage, "manifest", "distribution-manifest.sha256"),
        `${distributionManifestDigest(manifest)}\n`,
        { mode: 0o644 },
      );
      const sourceMetadata = JSON.parse(await readFile(resolve(sourcePackage, "package.json"), "utf8"));
      const metadata = {
        name: sourceMetadata.name,
        version: qualificationOnly ? "0.0.0-qualification" : sourceMetadata.version,
        description: sourceMetadata.description,
        type: sourceMetadata.type,
        files: sourceMetadata.files,
        bin: sourceMetadata.bin,
        engines: sourceMetadata.engines,
        repository: sourceMetadata.repository,
        publishConfig: sourceMetadata.publishConfig,
        ...(qualificationOnly ? { lifecycleQualificationOnly: true, private: true } : {}),
      };
      await writeFile(
        resolve(stage, "package.json"),
        `${JSON.stringify(metadata, null, 2)}\n`,
        { mode: 0o644 },
      );
      const npmSupport = resolve(stage, ".npm-support");
      await mkdir(npmSupport, { mode: 0o700 });
      const userConfig = resolve(npmSupport, "npmrc");
      await writeFile(userConfig, "\n", { mode: 0o600 });
      const result = run(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", selectedDestination],
        {
          cwd: stage,
          env: {
            HOME: npmSupport,
            PATH: process.env.PATH,
            TMPDIR: process.env.TMPDIR,
            npm_config_audit: "false",
            npm_config_cache: resolve(npmSupport, "cache"),
            npm_config_fund: "false",
            npm_config_update_notifier: "false",
            npm_config_userconfig: userConfig,
          },
        },
      );
      const packed = JSON.parse(result.stdout);
      const expected = qualificationOnly
        ? "neutral-lifecycle-0.0.0-qualification.tgz"
        : "neutral-lifecycle-1.0.0.tgz";
      if (!Array.isArray(packed) || packed.length !== 1 || packed[0]?.filename !== expected) {
        fail(`npm did not produce the one expected ${qualificationOnly ? "qualification" : "release"} tarball`);
      }
      const packagePath = join(selectedDestination, basename(packed[0].filename));
      const packageDigest = `sha256:${createHash("sha256").update(await readFile(packagePath)).digest("hex")}`;
      return Object.freeze({
        manifestDigest: distributionManifestDigest(manifest),
        package: packagePath,
        packageDigest,
        qualificationOnly,
      });
    } finally {
      await rm(stage, { force: true, recursive: true });
    }
  };

  return qualificationOnly
    ? await packFromSource(repositoryRoot)
    : await withExactSourceSnapshot(selectedSourceRevision, packFromSource);
}
