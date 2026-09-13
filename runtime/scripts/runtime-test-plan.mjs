import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

export const MAXIMUM_RUNTIME_TEST_FILES = 256;

const exclusiveTestNames = new Set([
  "foundation-package-staging.test.js",
]);

const qualificationTestNames = new Set([
  "foundation-setup-qualification.test.js",
]);

const comparePaths = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const connectedFastNames = new Set([
  "foundation-connected-knowledge.test.js",
  "foundation-connected-attempt-output.test.js",
  "foundation-connected-integration-correction.test.js",
  "foundation-connected-resolution.test.js",
]);

const connectedBoundedNames = new Set([
  ...connectedFastNames,
  "foundation-connected-execution-recovery.test.js",
  "foundation-connected-publication.test.js",
  "foundation-connected-terminal-recovery.test.js",
]);

export function selectRuntimeTestFiles(testFiles, profile = "all") {
  if (!["all", "connected-fast", "connected-bounded"].includes(profile)) {
    throw new Error(`Unknown Runtime test profile: ${profile}`);
  }
  const connected = testFiles.filter((path) => basename(path).startsWith("foundation-connected-"));
  const requiredNames = profile === "connected-fast" ? connectedFastNames : connectedBoundedNames;
  for (const required of requiredNames) {
    if (!connected.some((path) => basename(path) === required)) {
      throw new Error(`Connected Runtime profile requires compiled ${required}; build the Runtime first`);
    }
  }
  if (profile === "all") {
    return testFiles.filter((path) => !qualificationTestNames.has(basename(path)));
  }
  return profile === "connected-fast"
    ? connected.filter((path) => connectedFastNames.has(basename(path)))
    : connected;
}

export async function discoverRuntimeTestFiles(testDirectory, runtimeRoot) {
  const entries = await readdir(testDirectory, {
    withFileTypes: true,
    recursive: true,
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
    .map((entry) => relative(runtimeRoot, join(entry.parentPath, entry.name)))
    .sort(comparePaths);
}

export function planRuntimeTestBatches(testFiles) {
  if (testFiles.length === 0 || testFiles.length > MAXIMUM_RUNTIME_TEST_FILES) {
    throw new Error(
      `Runtime test discovery requires between 1 and ${MAXIMUM_RUNTIME_TEST_FILES} compiled test files; observed ${testFiles.length}`,
    );
  }

  const concurrentTestFiles = testFiles.filter((path) =>
    !exclusiveTestNames.has(basename(path)));
  const exclusiveTestFiles = testFiles.filter((path) =>
    exclusiveTestNames.has(basename(path)));

  return [
    ...(concurrentTestFiles.length === 0
      ? []
      : [{ concurrency: 4, files: concurrentTestFiles }]),
    ...exclusiveTestFiles.map((path) => ({ concurrency: 1, files: [path] })),
  ];
}
