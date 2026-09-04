#!/usr/bin/env node

import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { verifyRunnerContract } from "./verify-runner-contract.mjs";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const EXPECTED_TYPESCRIPT_VERSION = "5.8.3";
const EXPECTED_TYPESCRIPT_INTEGRITY =
  "sha512-p1diW6TqL9L07nNxvRMM7hMMw4c5XOo/1ibL4aAIGmSAt9slTE1Xgw5KWuof2uTOvCg9BY7ZRi+GaF+7sfgPeQ==";

function fail(message) {
  throw new Error(`Execution Cell runner source verification failed: ${message}`);
}

async function selectedCompiler() {
  const lock = JSON.parse(await readFile(
    resolve(repositoryRoot, "runtime/execution-image/runner-build/package-lock.json"),
    "utf8",
  ));
  const selected = lock?.packages?.["node_modules/typescript"];
  if (lock?.lockfileVersion !== 3 || lock?.packages?.[""]?.dependencies?.typescript !==
      EXPECTED_TYPESCRIPT_VERSION || selected?.version !== EXPECTED_TYPESCRIPT_VERSION ||
      selected?.integrity !== EXPECTED_TYPESCRIPT_INTEGRITY) {
    fail("checked-in runner compiler lock does not select the exact compiler");
  }
  const installedPackage = JSON.parse(await readFile(
    resolve(repositoryRoot, "node_modules/typescript/package.json"),
    "utf8",
  ));
  if (installedPackage.version !== EXPECTED_TYPESCRIPT_VERSION) {
    fail("installed repository compiler differs from the runner compiler lock");
  }
  return resolve(repositoryRoot, "node_modules/typescript/bin/tsc");
}

export async function verifyRunnerSource() {
  const outputRoot = await mkdtemp(join(tmpdir(), "lifecycle-runner-source-"));
  try {
    const sourceRoot = resolve(outputRoot, "source");
    const sourcePath = resolve(sourceRoot, "src/util/execution-cell-runner-v1.ts");
    await mkdir(resolve(sourceRoot, "src/util"), { recursive: true });
    await Promise.all([
      copyFile(
        resolve(repositoryRoot, "runtime/src/util/execution-cell-runner-v1.ts"),
        sourcePath,
      ),
      copyFile(
        resolve(repositoryRoot, "runtime/execution-image/runner-build/package.json"),
        resolve(outputRoot, "package.json"),
      ),
    ]);
    await execute(process.execPath, [
      await selectedCompiler(),
      "--noCheck",
      "--target", "ES2022",
      "--module", "NodeNext",
      "--moduleResolution", "NodeNext",
      "--rootDir", sourceRoot,
      "--outDir", resolve(outputRoot, "output"),
      sourcePath,
    ], { cwd: repositoryRoot });
    return await verifyRunnerContract({
      manifestPath: resolve(repositoryRoot, "runtime/execution-image/runner-contract.private.json"),
      runnerPath: resolve(outputRoot, "output/src/util/execution-cell-runner-v1.js"),
    });
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await verifyRunnerSource())}\n`);
}
