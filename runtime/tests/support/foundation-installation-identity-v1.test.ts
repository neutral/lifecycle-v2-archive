import assert from "node:assert/strict";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import {
  ensureFoundationInstallationIdentityV1,
  FOUNDATION_INSTALLATION_IDENTITY_SCHEMA_V1,
  foundationInstallationIdentityPathsV1,
} from "../../src/foundation/installation-identity-v1.js";
import { canonicalJsonLine } from "../../src/foundation/validation/canonical.js";

async function fixture(context: test.TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-installation-identity-v1-")));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const machineHome = join(root, "machine-home");
  await mkdir(machineHome, { mode: 0o700 });
  return machineHome;
}

function generated(byte: number): string {
  return `installation.lifecycle.${byte.toString(16).padStart(2, "0").repeat(32)}`;
}

function random(byte: number): () => Uint8Array {
  return () => new Uint8Array(32).fill(byte);
}

function identityError(suffix: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert(error instanceof FoundationError);
    assert.equal(error.code, `lifecycle.installation-identity-v1.${suffix}`);
    return true;
  };
}

test("installation identity is one durable private carrier independent of its machine-home path", async (context) => {
  const firstHome = await fixture(context);
  const secondHome = await fixture(context);

  const first = await ensureFoundationInstallationIdentityV1(firstHome, {
    randomIdentityBytes: random(0x11),
  });
  const second = await ensureFoundationInstallationIdentityV1(secondHome, {
    randomIdentityBytes: random(0x22),
  });
  assert.deepEqual(first, {
    schema: FOUNDATION_INSTALLATION_IDENTITY_SCHEMA_V1,
    installationId: generated(0x11),
  });
  assert.equal(second.installationId, generated(0x22));
  assert.notEqual(first.installationId, second.installationId);

  const paths = foundationInstallationIdentityPathsV1(firstHome);
  const [rootState, identityState, lockState] = await Promise.all([
    lstat(paths.root),
    lstat(paths.identity),
    lstat(paths.lock),
  ]);
  assert.equal(rootState.mode & 0o7777, 0o700);
  assert.equal(identityState.mode & 0o7777, 0o600);
  assert.equal(identityState.nlink, 1);
  assert.equal(lockState.mode & 0o7777, 0o600);
  assert.equal(
    await readFile(paths.identity, "utf8"),
    canonicalJsonLine(first),
  );
  await assert.rejects(access(paths.pending), { code: "ENOENT" });

  const reopened = await ensureFoundationInstallationIdentityV1(firstHome, {
    randomIdentityBytes: random(0x33),
  });
  assert.equal(reopened.installationId, first.installationId);
});

test("installation identity publishes a valid interrupted pending carrier exactly once", async (context) => {
  const machineHome = await fixture(context);
  const paths = foundationInstallationIdentityPathsV1(machineHome);
  const created = await ensureFoundationInstallationIdentityV1(machineHome, {
    randomIdentityBytes: random(0x44),
  });
  await rename(paths.identity, paths.pending);

  const recovered = await ensureFoundationInstallationIdentityV1(machineHome, {
    randomIdentityBytes: random(0x55),
  });
  assert.equal(recovered.installationId, created.installationId);
  assert.equal(await readFile(paths.identity, "utf8"), canonicalJsonLine(created));
  await assert.rejects(access(paths.pending), { code: "ENOENT" });
});

test("installation identity replaces only a bounded invalid pending carrier", async (context) => {
  const machineHome = await fixture(context);
  const paths = foundationInstallationIdentityPathsV1(machineHome);
  await ensureFoundationInstallationIdentityV1(machineHome, {
    randomIdentityBytes: random(0x66),
  });
  await rename(paths.identity, paths.pending);
  await writeFile(paths.pending, "not canonical identity JSON\n", { mode: 0o600 });
  await chmod(paths.pending, 0o600);

  const replaced = await ensureFoundationInstallationIdentityV1(machineHome, {
    randomIdentityBytes: random(0x77),
  });
  assert.equal(replaced.installationId, generated(0x77));
  await assert.rejects(access(paths.pending), { code: "ENOENT" });
});

test("installation identity refuses final-carrier substitution and unsupported root entries", async (context) => {
  const substitutedHome = await fixture(context);
  const substitutedPaths = foundationInstallationIdentityPathsV1(substitutedHome);
  await ensureFoundationInstallationIdentityV1(substitutedHome, {
    randomIdentityBytes: random(0x88),
  });
  const outside = join(substitutedHome, "outside-identity.json");
  await writeFile(outside, await readFile(substitutedPaths.identity), { mode: 0o600 });
  await rm(substitutedPaths.identity);
  await symlink(outside, substitutedPaths.identity);
  await assert.rejects(
    ensureFoundationInstallationIdentityV1(substitutedHome),
    identityError("file"),
  );

  const extraHome = await fixture(context);
  const extraPaths = foundationInstallationIdentityPathsV1(extraHome);
  await ensureFoundationInstallationIdentityV1(extraHome, {
    randomIdentityBytes: random(0x99),
  });
  await writeFile(join(extraPaths.root, "unexpected"), "unsupported\n", { mode: 0o600 });
  await assert.rejects(
    ensureFoundationInstallationIdentityV1(extraHome),
    identityError("layout"),
  );
});

test("installation identity refuses malformed retained truth instead of silently replacing it", async (context) => {
  const machineHome = await fixture(context);
  const paths = foundationInstallationIdentityPathsV1(machineHome);
  await ensureFoundationInstallationIdentityV1(machineHome, {
    randomIdentityBytes: random(0xaa),
  });
  await writeFile(paths.identity, "{}\n", { mode: 0o600 });
  await chmod(paths.identity, 0o600);
  await assert.rejects(
    ensureFoundationInstallationIdentityV1(machineHome, {
      randomIdentityBytes: random(0xbb),
    }),
    identityError("content"),
  );
});
