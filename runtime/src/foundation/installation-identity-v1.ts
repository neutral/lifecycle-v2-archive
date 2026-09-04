import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { FoundationError } from "./error.js";
import { foundationDescriptorLockProvider } from "./support/descriptor-lock.js";
import { canonicalJsonLine } from "./validation/canonical.js";

export const FOUNDATION_INSTALLATION_IDENTITY_SCHEMA_V1 =
  "lifecycle.installation-identity.private.v1" as const;

const INSTALLATION_DIRECTORY = "installation";
const IDENTITY_FILE = "identity.json";
const PENDING_FILE = "identity.pending.json";
const LOCK_FILE = "identity.lock";
const MAXIMUM_IDENTITY_BYTES = 512;
const INSTALLATION_ID_PATTERN = /^installation\.lifecycle\.[a-f0-9]{64}$/u;

export type FoundationInstallationIdentityV1 = Readonly<{
  schema: typeof FOUNDATION_INSTALLATION_IDENTITY_SCHEMA_V1;
  installationId: string;
}>;

export type FoundationInstallationIdentityPathsV1 = Readonly<{
  root: string;
  identity: string;
  pending: string;
  lock: string;
}>;

function fail(code: string, message: string, retryable = false): never {
  throw new FoundationError(`lifecycle.installation-identity-v1.${code}`, message, {
    retryable,
    recoveryActions: retryable
      ? [{ action: "retry", detail: "Retry after the active Lifecycle installation operation finishes." }]
      : [],
  });
}

function effectiveUid(): bigint | null {
  const value = process.geteuid?.() ?? process.getuid?.();
  return value === undefined ? null : BigInt(value);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return Object.getOwnPropertySymbols(value).length === 0 &&
    JSON.stringify(Object.getOwnPropertyNames(value).sort()) ===
      JSON.stringify([...expected].sort());
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertOwnedDirectory(path: string, label: string, mode?: number): Promise<string> {
  const requested = resolve(path);
  let physical: string;
  let state: Awaited<ReturnType<typeof lstat>>;
  try {
    [physical, state] = await Promise.all([realpath(requested), lstat(requested)]);
  } catch {
    return fail("directory", `${label} is unavailable`);
  }
  const uid = effectiveUid();
  if (physical !== requested || state.isSymbolicLink() || !state.isDirectory() ||
      (uid !== null && BigInt(state.uid) !== uid) ||
      (mode !== undefined && (state.mode & 0o7777) !== mode)) {
    fail("directory", `${label} is not one exact owned private directory`);
  }
  return physical;
}

async function ensureInstallationDirectory(machineHome: string): Promise<string> {
  const home = await assertOwnedDirectory(machineHome, "Lifecycle machine home");
  const root = join(home, INSTALLATION_DIRECTORY);
  let created = false;
  try {
    await mkdir(root, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const owned = await assertOwnedDirectory(root, "Lifecycle installation identity root");
  await chmod(owned, 0o700);
  await assertOwnedDirectory(owned, "Lifecycle installation identity root", 0o700);
  if (created) await syncDirectory(home);
  return owned;
}

export function foundationInstallationIdentityPathsV1(
  machineHome: string,
): FoundationInstallationIdentityPathsV1 {
  const root = join(resolve(machineHome), INSTALLATION_DIRECTORY);
  return Object.freeze({
    root,
    identity: join(root, IDENTITY_FILE),
    pending: join(root, PENDING_FILE),
    lock: join(root, LOCK_FILE),
  });
}

async function boundedEntries(path: string): Promise<readonly string[]> {
  const entries: string[] = [];
  const directory = await opendir(path);
  try {
    for await (const entry of directory) {
      entries.push(entry.name);
      if (entries.length > 3) {
        fail("layout", "Lifecycle installation identity root exceeds its exact entry bound");
      }
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  return Object.freeze(entries.sort());
}

async function assertExactFile(path: string, label: string): Promise<Awaited<ReturnType<typeof lstat>>> {
  let state: Awaited<ReturnType<typeof lstat>>;
  let physical: string;
  try {
    [state, physical] = await Promise.all([lstat(path), realpath(path)]);
  } catch {
    return fail("file", `${label} is unavailable`);
  }
  const uid = process.geteuid?.() ?? process.getuid?.();
  if (physical !== path || state.isSymbolicLink() || !state.isFile() || state.nlink !== 1 ||
      (state.mode & 0o7777) !== 0o600 || (uid !== undefined && state.uid !== uid) ||
      state.size > MAXIMUM_IDENTITY_BYTES) {
    fail("file", `${label} is not one exact owned private regular file`);
  }
  return state;
}

async function readIdentity(path: string, label: string): Promise<FoundationInstallationIdentityV1> {
  const selected = await assertExactFile(path, label);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.dev !== selected.dev || opened.ino !== selected.ino ||
        opened.size !== selected.size || opened.mtimeMs !== selected.mtimeMs ||
        opened.ctimeMs !== selected.ctimeMs) {
      fail("file-drift", `${label} changed while opened`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
        after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      fail("file-drift", `${label} changed while read`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      return fail("content", `${label} does not contain exact canonical JSON`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
        !exactKeys(parsed, ["installationId", "schema"])) {
      fail("content", `${label} is not one closed installation identity value`);
    }
    const value = parsed as Record<string, unknown>;
    if (value.schema !== FOUNDATION_INSTALLATION_IDENTITY_SCHEMA_V1 ||
        typeof value.installationId !== "string" ||
        !INSTALLATION_ID_PATTERN.test(value.installationId)) {
      fail("content", `${label} has unsupported installation identity coordinates`);
    }
    const identity = Object.freeze({
      schema: FOUNDATION_INSTALLATION_IDENTITY_SCHEMA_V1,
      installationId: value.installationId,
    });
    if (!bytes.equals(Buffer.from(canonicalJsonLine(identity), "utf8"))) {
      fail("content", `${label} bytes are not the exact canonical identity carrier`);
    }
    return identity;
  } finally {
    await handle.close();
  }
}

async function openLock(path: string) {
  const handle = await open(
    path,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  const uid = process.geteuid?.() ?? process.getuid?.();
  let state = await handle.stat();
  if (!state.isFile() || state.nlink !== 1 || (uid !== undefined && state.uid !== uid)) {
    await handle.close();
    return fail("lock", "Lifecycle installation identity lock is not one owned regular file");
  }
  await handle.chmod(0o600);
  state = await handle.stat();
  if (!state.isFile() || state.nlink !== 1 || (state.mode & 0o7777) !== 0o600) {
    await handle.close();
    return fail("lock", "Lifecycle installation identity lock could not be made private");
  }
  return handle;
}

/** Create or reopen the sole durable identity for one installed machine custody root. */
export async function ensureFoundationInstallationIdentityV1(
  machineHome: string,
  options: Readonly<{ randomIdentityBytes?: () => Uint8Array }> = {},
): Promise<FoundationInstallationIdentityV1> {
  const root = await ensureInstallationDirectory(machineHome);
  const paths = foundationInstallationIdentityPathsV1(machineHome);
  const lock = await openLock(paths.lock);
  try {
    const provider = foundationDescriptorLockProvider();
    if (provider === null) {
      fail("lock-provider", "Lifecycle has no installed installation-identity lock provider");
    }
    const acquired = spawnSync(provider.executable, provider.arguments, {
      env: {},
      stdio: ["ignore", "ignore", "ignore", lock.fd],
      windowsHide: true,
    });
    if (acquired.error || acquired.status === null ||
        (acquired.status !== 0 && acquired.status !== provider.contentionExitCode)) {
      fail("lock-provider", "Lifecycle could not acquire its installation identity lock");
    }
    if (acquired.status === provider.contentionExitCode) {
      fail("busy", "Another Lifecycle operation is establishing the installation identity", true);
    }

    const entries = await boundedEntries(root);
    const allowed = new Set([LOCK_FILE, IDENTITY_FILE, PENDING_FILE]);
    if (entries.some((entry) => !allowed.has(entry))) {
      fail("layout", "Lifecycle installation identity root contains an unsupported entry");
    }
    const hasIdentity = entries.includes(IDENTITY_FILE);
    const hasPending = entries.includes(PENDING_FILE);
    if (hasIdentity && hasPending) {
      fail("layout", "Lifecycle installation identity root contains conflicting carriers");
    }
    if (hasIdentity) return await readIdentity(paths.identity, "Lifecycle installation identity");

    if (hasPending) {
      try {
        await readIdentity(paths.pending, "Pending Lifecycle installation identity");
      } catch (error) {
        await assertExactFile(paths.pending, "Pending Lifecycle installation identity");
        await unlink(paths.pending);
        await syncDirectory(root);
      }
    }
    if (!hasPending || !(await boundedEntries(root)).includes(PENDING_FILE)) {
      const bytes = options.randomIdentityBytes?.() ?? randomBytes(32);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
        fail("randomness", "Lifecycle installation identity generation returned an invalid value");
      }
      const identity = Object.freeze({
        schema: FOUNDATION_INSTALLATION_IDENTITY_SCHEMA_V1,
        installationId: `installation.lifecycle.${Buffer.from(bytes).toString("hex")}`,
      });
      const pending = await open(
        paths.pending,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await pending.writeFile(canonicalJsonLine(identity), "utf8");
        await pending.sync();
      } finally {
        await pending.close();
      }
      await chmod(paths.pending, 0o600);
      await syncDirectory(root);
    }
    const recovered = await readIdentity(paths.pending, "Pending Lifecycle installation identity");
    await rename(paths.pending, paths.identity);
    await syncDirectory(root);
    const retained = await readIdentity(paths.identity, "Lifecycle installation identity");
    if (retained.installationId !== recovered.installationId) {
      fail("file-drift", "Lifecycle installation identity changed while published");
    }
    return retained;
  } finally {
    await lock.close();
  }
}
