import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const TUI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_ROOT = join(TUI_ROOT, "dist", "tests");
const files = (await readdir(TEST_ROOT))
  .filter((name) => name.endsWith(".test.js"))
  .sort();
const nodeExecutable = process.env.npm_node_execpath ?? process.env.NODE;

if (files.length === 0) throw new Error("No compiled TUI tests were found");
if (nodeExecutable === undefined) {
  throw new Error("The npm package-test host did not identify its exact Node executable");
}

for (const file of files) {
  const child = spawn(process.execPath, ["test", "--timeout", "30000", join(TEST_ROOT, file)], {
    cwd: TUI_ROOT,
    env: { ...process.env, LIFECYCLE_TUI_TEST_NODE: nodeExecutable },
    stdio: "inherit",
  });
  const result = await new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({ code, signal }));
  });
  if (result.code !== 0 || result.signal !== null) {
    throw new Error(`TUI test ${file} failed (${result.signal ?? result.code})`);
  }
}
