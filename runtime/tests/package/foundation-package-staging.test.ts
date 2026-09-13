import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const stagingScript = new URL("../../../scripts/stage-bundled-dependencies.mjs", import.meta.url);
const stagingRoot = new URL("../../../node_modules/", import.meta.url);
const protocolRoot = new URL("../../../node_modules/@neutral/lifecycle-protocol/", import.meta.url);
const runtimeRoot = new URL("../../../", import.meta.url);

const RETIRED_RUNTIME_MODULES = Object.freeze([
  "foundation/assessment/attempt-assessment-document",
  "foundation/attempt/agent-attempt-document",
  "foundation/attempt/assessment",
  "foundation/attempt/bundle-filesystem",
  "foundation/attempt/carriers",
  "foundation/attempt/codex-adapter",
  "foundation/attempt/codex-adapter-v2",
  "foundation/attempt/codex-exec-permissions",
  "foundation/attempt/codex-exec-transport",
  "foundation/attempt/codex-exec",
  "foundation/attempt/codex-executable",
  "foundation/attempt/construction",
  "foundation/attempt/execution-receipt-document",
  "foundation/attempt/freshness",
  "foundation/attempt/input-bundle-v2",
  "foundation/attempt/input-material-v2",
  "foundation/attempt/investment-allocation",
  "foundation/attempt/material",
  "foundation/attempt/physical-roots",
  "foundation/attempt/docker-endpoint",
  "foundation/attempt/private-invocation-cleanup",
  "foundation/attempt/private-root-table-v2",
  "foundation/attempt/profiles",
  "foundation/attempt/provider-descriptor-v2",
  "foundation/attempt/provider-host",
  "foundation/attempt/provider-materialization-v4",
  "foundation/attempt/provider-operation-host",
  "foundation/attempt/provider-runner-v4",
  "foundation/attempt/receipt",
  "foundation/attempt/results",
  "foundation/attempt/role",
  "foundation/attempt/role-brief",
  "foundation/attempt/role-result-document",
  "foundation/attempt/semantic-markdown-rendering-v2",
  "foundation/attempt/semantic-result",
  "foundation/attempt/semantic-return-observation",
  "foundation/attempt/semantic-validator-client",
  "foundation/attempt/semantic-validator-custody",
  "foundation/attempt/semantic-validator-protocol",
  "foundation/attempt/semantic-validator-server",
  "foundation/attempt/semantic-validator-tool",
  "foundation/attempt/subjects",
  "foundation/attempt/support",
  "foundation/attempt/types",
  "foundation/attempt/tool-environment",
  "foundation/candidate/custody",
  "foundation/candidate/observation",
  "foundation/control/authoring-workspace",
  "foundation/delivery/acceptance",
  "foundation/delivery/admission-subject-v1",
  "foundation/delivery/admission-operation",
  "foundation/delivery/admission",
  "foundation/delivery/admitted-work-boundary-document",
  "foundation/delivery/attempt-preparation",
  "foundation/delivery/authority-envelope",
  "foundation/delivery/authority-subjects",
  "foundation/delivery/boundary-ancestry",
  "foundation/delivery/boundary-resolution",
  "foundation/delivery/candidate-observation",
  "foundation/delivery/candidate-observation-document",
  "foundation/delivery/closure",
  "foundation/delivery/closure-document",
  "foundation/delivery/evaluation",
  "foundation/delivery/material-condition",
  "foundation/delivery/material-condition-document",
  "foundation/delivery/no-ship",
  "foundation/delivery/no-ship-candidate-observer-v1",
  "foundation/delivery/no-ship-selection-document-v2",
  "foundation/delivery/preparation",
  "foundation/delivery/process-state",
  "foundation/delivery/productive",
  "foundation/delivery/protected-transaction",
  "foundation/delivery/support",
  "foundation/delivery/terminal",
  "foundation/delivery/terminal-observation-documents",
  "foundation/delivery/terminal-subject-v1",
  "foundation/delivery/work-boundary",
  "foundation/delivery/work-boundary-documents",
  "foundation/documents/control-document",
  "foundation/documents/reference",
  "foundation/evidence/candidate-seal",
  "foundation/evidence/candidate-seal-document",
  "foundation/evidence/candidate-sealer-v3",
  "foundation/evidence/check-receipt",
  "foundation/evidence/check-receipt-document",
  "foundation/evidence/check-runner",
  "foundation/evidence/evidence-packet",
  "foundation/evidence/evidence-component-documents",
  "foundation/evidence/evidence-packet-document",
  "foundation/evidence/evaluation-completion-v1",
  "foundation/evidence/evaluation-preparation-v1",
  "foundation/evidence/reviewer-evidence",
  "foundation/evidence/support",
  "foundation/evidence/types",
  "foundation/process/admission-checkpoint-v1",
  "foundation/process/admission-coordinator-v3",
  "foundation/process/attached-private-process-support-v1",
  "foundation/process/funded-attempt-checkpoint-v1",
  "foundation/process/funded-attempt-coordinator-v3",
  "foundation/process/funded-evaluation-preparation-checkpoint-v1",
  "foundation/process/funded-execution-input-checkpoint-v1",
  "foundation/process/candidate-physical-basis-v7",
  "foundation/process/journal-event",
  "foundation/process/journal-reducer",
  "foundation/process/journal-store",
  "foundation/process/mutation-coordinator-v3",
  "foundation/process/private-operation-package-v3",
  "foundation/process/private-process-support-v1",
  "foundation/process/physical-effect-custody-v7",
  "foundation/process/provider-checkpoint-v1",
  "foundation/process/resolution-coordinator-v3",
  "foundation/process/resolution-input-checkpoint-v1",
  "foundation/process/secure-private-store-v1",
  "foundation/process/terminal-transaction-checkpoint-v1",
  "foundation/process/terminal-transaction-coordinator-v3",
  "foundation/repository/canonical-work-boundary",
  "foundation/repository/control-index-document",
  "util/codex-process-guardian",
  "util/private-invocation-cleanup-protocol",
  "util/private-invocation-cleanup-removal",
  "util/private-invocation-cleanup-remover",
  "util/private-invocation-cleanup-supervisor",
  "util/provider-operation-worker",
] as const);

const CURRENT_RUNTIME_MODULES = Object.freeze([
  "foundation/attempt/execution-cell-v1",
  "foundation/candidate/carrier-state-observer",
  "foundation/check/execution-cell-v1",
  "foundation/control/attempt-view",
  "foundation/control/delivery-custody",
  "foundation/control/inspection",
  "foundation/control/store",
  "foundation/execution/backend",
  "foundation/execution/contracts",
  "foundation/execution/docker-backend",
  "foundation/execution/docker-binding-registry-v1",
  "foundation/execution/docker-cli-engine-driver-v1",
  "foundation/execution/docker-profile-v1",
  "foundation/execution/input-set",
  "foundation/execution/installed-agent-runtime-v1",
  "foundation/execution/installed-check-runtime-v1",
  "foundation/execution/operation-host",
  "foundation/execution/output-store-v1",
  "foundation/execution/output-validation",
  "foundation/execution/reclamation-ledger-v1",
  "foundation/process/activity-child-checkpoint-v7",
  "foundation/process/activity-kernel-v7",
  "foundation/process/agent-operation-v7",
  "foundation/process/candidate-agent-runtime-v7",
  "foundation/process/check-operation-v7",
  "foundation/process/evaluation-runtime-v7",
  "foundation/process/preparation-runtime-v7",
  "foundation/process/transaction-observation-facts-v7",
  "foundation/runtime-mutation-v7",
  "foundation/transaction/admission-v7",
  "foundation/transaction/terminal-v7",
  "util/execution-cell-runner-v1",
] as const);

async function exists(path: URL): Promise<boolean> {
  return lstat(path).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}

async function files(root: URL, prefix = ""): Promise<string[]> {
  const output: string[] = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name))) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) output.push(...await files(new URL(`${entry.name}/`, root), `${path}/`));
    else output.push(path);
  }
  return output;
}

test("runtime package staging copies the exact workspace protocol publication surface", async (context) => {
  context.after(async () => {
    await execute(process.execPath, [stagingScript.pathname, "cleanup"]);
  });
  await execute(process.execPath, [stagingScript.pathname, "prepare"]);

  assert.equal((await lstat(protocolRoot)).isSymbolicLink(), false);
  assert.deepEqual(await files(protocolRoot), [
    "dist/src/foundation/atlas-inspection.d.ts",
    "dist/src/foundation/atlas-inspection.js",
    "dist/src/foundation/atlas-inspection.js.map",
    "dist/src/foundation/attempt-view.d.ts",
    "dist/src/foundation/attempt-view.js",
    "dist/src/foundation/attempt-view.js.map",
    "dist/src/foundation/authorization-review.d.ts",
    "dist/src/foundation/authorization-review.js",
    "dist/src/foundation/authorization-review.js.map",
    "dist/src/foundation/code-inspection.d.ts",
    "dist/src/foundation/code-inspection.js",
    "dist/src/foundation/code-inspection.js.map",
    "dist/src/foundation/context-core.d.ts",
    "dist/src/foundation/context-core.js",
    "dist/src/foundation/context-core.js.map",
    "dist/src/foundation/context-inspection.d.ts",
    "dist/src/foundation/context-inspection.js",
    "dist/src/foundation/context-inspection.js.map",
    "dist/src/foundation/core.d.ts",
    "dist/src/foundation/core.js",
    "dist/src/foundation/core.js.map",
    "dist/src/foundation/internal.d.ts",
    "dist/src/foundation/internal.js",
    "dist/src/foundation/internal.js.map",
    "dist/src/foundation/knowledge-inspection.d.ts",
    "dist/src/foundation/knowledge-inspection.js",
    "dist/src/foundation/knowledge-inspection.js.map",
    "dist/src/foundation/recovery.d.ts",
    "dist/src/foundation/recovery.js",
    "dist/src/foundation/recovery.js.map",
    "dist/src/foundation/requests.d.ts",
    "dist/src/foundation/requests.js",
    "dist/src/foundation/requests.js.map",
    "dist/src/foundation/results.d.ts",
    "dist/src/foundation/results.js",
    "dist/src/foundation/results.js.map",
    "dist/src/foundation/version.d.ts",
    "dist/src/foundation/version.js",
    "dist/src/foundation/version.js.map",
    "dist/src/foundation.d.ts",
    "dist/src/foundation.js",
    "dist/src/foundation.js.map",
    "dist/src/protocol-error.d.ts",
    "dist/src/protocol-error.js",
    "dist/src/protocol-error.js.map",
    "dist/src/strict-json.d.ts",
    "dist/src/strict-json.js",
    "dist/src/strict-json.js.map",
    "package.json",
  ]);
  const protocol = JSON.parse(await readFile(new URL("package.json", protocolRoot), "utf8")) as {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    bundledDependencies?: string[];
  };
  assert.deepEqual(
    {
      name: protocol.name,
      version: protocol.version,
      dependencies: protocol.dependencies,
      bundledDependencies: protocol.bundledDependencies,
    },
    {
      name: "@neutral/lifecycle-protocol",
      version: "1.0.0",
      dependencies: { "@noble/hashes": "2.4.0", zod: "4.4.3" },
      bundledDependencies: ["@noble/hashes", "zod"],
    },
  );
  const zod = JSON.parse(await readFile(new URL("../../zod/package.json", protocolRoot), "utf8")) as {
    name?: string;
    version?: string;
  };
  assert.deepEqual({ name: zod.name, version: zod.version }, { name: "zod", version: "4.4.3" });
  const noble = JSON.parse(await readFile(new URL("../../@noble/hashes/package.json", protocolRoot), "utf8")) as {
    name?: string;
    version?: string;
  };
  assert.deepEqual({ name: noble.name, version: noble.version }, { name: "@noble/hashes", version: "2.4.0" });
  const atlas = JSON.parse(await readFile(new URL("atlas-reference-validator/package.json", stagingRoot), "utf8")) as {
    name?: string; version?: string; dependencies?: Record<string, string>;
  };
  assert.deepEqual({ name: atlas.name, version: atlas.version, dependencies: atlas.dependencies }, {
    name: "atlas-reference-validator", version: "0.8.0",
    dependencies: { "@hyperjump/uri": "1.3.5", ajv: "8.20.0", "markdown-it": "14.3.0" },
  });

  await execute(process.execPath, [stagingScript.pathname, "cleanup"]);
  assert.equal(await lstat(stagingRoot).then(() => true, () => false), false);
});

test("runtime package inventory and exports contain no retired implementation surface", async (context) => {
  const cache = await mkdtemp(join(tmpdir(), "lifecycle-runtime-pack-cache-"));
  context.after(async () => {
    await execute(process.execPath, [stagingScript.pathname, "cleanup"]);
    await rm(cache, { recursive: true, force: true });
  });

  for (const modulePath of RETIRED_RUNTIME_MODULES) {
    assert.equal(
      await exists(new URL(`../../../src/${modulePath}.ts`, import.meta.url)),
      false,
      `retired source module remains: ${modulePath}`,
    );
    for (const extension of ["js", "js.map", "d.ts"]) {
      assert.equal(
        await exists(new URL(`../../src/${modulePath}.${extension}`, import.meta.url)),
        false,
        `retired distribution module remains: ${modulePath}.${extension}`,
      );
    }
  }
  for (const modulePath of CURRENT_RUNTIME_MODULES) {
    assert.equal(
      await exists(new URL(`../../../src/${modulePath}.ts`, import.meta.url)),
      true,
      `current Foundation source module is absent: ${modulePath}`,
    );
    for (const extension of ["js", "js.map", "d.ts"]) {
      assert.equal(
        await exists(new URL(`../../src/${modulePath}.${extension}`, import.meta.url)),
        true,
        `current Foundation distribution module is absent: ${modulePath}.${extension}`,
      );
    }
  }

  const root = await import("@neutral/lifecycle-runtime");
  assert.equal(typeof root.dispatchFoundationCli, "function");
  const retiredSpecifier = "@neutral/lifecycle-runtime/dist/src/foundation/attempt/assessment.js";
  await assert.rejects(
    import(retiredSpecifier),
    (error: unknown) => error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );

  const packed = await execute(
    "npm",
    ["pack", "--silent", "--json", "--dry-run", "--cache", cache],
    { cwd: runtimeRoot.pathname, maxBuffer: 128 * 1024 * 1024 },
  );
  const reports = JSON.parse(packed.stdout) as Array<Readonly<{
    name: string;
    version: string;
    files: readonly Readonly<{ path: string; size: number; mode: number }>[];
  }>>;
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.name, "@neutral/lifecycle-runtime");
  assert.equal(reports[0]?.version, "1.0.0");
  const paths = reports[0]?.files.map(({ path }) => path) ?? [];
  assert(paths.includes("package.json"));
  assert(paths.includes("bin/lifecycle.mjs"));
  assert(paths.includes("dist/src/index.js"));
  assert.equal(paths.some((path) =>
    path.startsWith("dist/tests/") ||
    (path.startsWith("dist/src/") && path.endsWith(".ts") && !path.endsWith(".d.ts"))
  ), false);
  for (const modulePath of RETIRED_RUNTIME_MODULES) {
    assert.equal(
      paths.some((path) => path.startsWith(`dist/src/${modulePath}.`)),
      false,
      `retired module entered the tarball inventory: ${modulePath}`,
    );
  }
  for (const modulePath of CURRENT_RUNTIME_MODULES) {
    assert.equal(
      paths.some((path) => path.startsWith(`dist/src/${modulePath}.`)),
      true,
      `current Foundation module is absent from the tarball: ${modulePath}`,
    );
  }
});
