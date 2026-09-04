import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const protocolRoot = new URL("../../", import.meta.url);
const stagingScript = new URL("../../scripts/stage-bundled-dependency.mjs", import.meta.url);
const stagingRoot = new URL("../../node_modules/", import.meta.url);

test("protocol package staging contains only exact locked browser-safe dependencies", async (context) => {
  const existed = await lstat(stagingRoot).then(() => true, () => false);
  context.after(async () => {
    await execute(process.execPath, [stagingScript.pathname, "cleanup"]);
  });
  await execute(process.execPath, [stagingScript.pathname, "prepare"]);

  assert.deepEqual((await readdir(stagingRoot)).sort(), [
    ".lifecycle-foundation-protocol-pack-staging.json",
    "@noble",
    "zod",
  ]);
  assert.equal((await lstat(new URL("@noble/hashes/", stagingRoot))).isSymbolicLink(), false);
  assert.equal((await lstat(new URL("zod/", stagingRoot))).isSymbolicLink(), false);
  const installedNoble = JSON.parse(await readFile(new URL("@noble/hashes/package.json", stagingRoot), "utf8")) as {
    name?: string;
    version?: string;
  };
  const installedZod = JSON.parse(await readFile(new URL("zod/package.json", stagingRoot), "utf8")) as {
    name?: string;
    version?: string;
  };
  assert.deepEqual(
    { name: installedNoble.name, version: installedNoble.version },
    { name: "@noble/hashes", version: "2.4.0" },
  );
  assert.deepEqual(
    { name: installedZod.name, version: installedZod.version },
    { name: "zod", version: "4.4.3" },
  );

  const protocol = JSON.parse(await readFile(new URL("package.json", protocolRoot), "utf8")) as {
    dependencies?: Record<string, string>;
    bundledDependencies?: string[];
  };
  assert.deepEqual(protocol.dependencies, { "@noble/hashes": "2.4.0", zod: "4.4.3" });
  assert.deepEqual(protocol.bundledDependencies, ["@noble/hashes", "zod"]);

  await execute(process.execPath, [stagingScript.pathname, "cleanup"]);
  if (existed) assert.deepEqual(await readdir(stagingRoot), []);
  else assert.equal(await lstat(stagingRoot).then(() => true, () => false), false);
});
