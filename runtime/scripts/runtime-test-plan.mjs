import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

export const MAXIMUM_RUNTIME_TEST_FILES = 128;

const exclusiveTestNames = new Set([
  "foundation-package-staging.test.js",
]);

const comparePaths = (left, right) => left < right ? -1 : left > right ? 1 : 0;

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
