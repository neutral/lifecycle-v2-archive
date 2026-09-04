import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import test from "node:test";

async function filesBelow(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(root, path));
    else if (entry.isFile()) files.push(relative(root, path));
    else throw new Error(`Unexpected non-regular build carrier ${relative(root, path)}`);
  }
  return files.sort();
}

test("compiled Runtime output contains exactly the current TypeScript carriers", async () => {
  const runtimeRoot = resolve(import.meta.dirname, "..", "..", "..");
  const sourceFiles = [
    ...await filesBelow(runtimeRoot, resolve(runtimeRoot, "src")),
    ...await filesBelow(runtimeRoot, resolve(runtimeRoot, "tests")),
  ].filter((path) => path.endsWith(".ts") && !path.endsWith(".d.ts"));
  const expected = sourceFiles.flatMap((path) => {
    const stem = path.slice(0, -3);
    return [`${stem}.d.ts`, `${stem}.js`, `${stem}.js.map`];
  }).sort();
  const actual = await filesBelow(resolve(runtimeRoot, "dist"));

  assert.deepEqual(actual, expected);
});
