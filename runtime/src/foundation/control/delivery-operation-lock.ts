import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { FoundationError } from "../error.js";
import { foundationDescriptorLockProvider } from "../support/descriptor-lock.js";
import { digestCanonical } from "../validation/canonical.js";
import { controlIdentifier } from "./model.js";

type DeliveryOperationSelection = Readonly<{
  machineHome: string;
  targetId: string;
  deliveryId: string;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`operation.${code}`, message);
}

async function assertDirectory(path: string, privateMode: boolean): Promise<void> {
  const [metadata, physical] = await Promise.all([lstat(path), realpath(path)]);
  const uid = process.geteuid?.() ?? process.getuid?.();
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || physical !== path ||
      (uid !== undefined && metadata.uid !== uid) ||
      (privateMode && (metadata.mode & 0o7777) !== 0o700)) {
    fail("lock_directory", "Delivery operation locking requires exact owner-controlled physical directories");
  }
}

async function openDeliveryLock(selection: DeliveryOperationSelection) {
  try {
    const home = selection.machineHome;
    if (!isAbsolute(home) || resolve(home) !== home) {
      fail("lock_directory", "Delivery operation locking requires the canonical machine home");
    }
    await assertDirectory(home, false);
    // This permanent support is outside the Store's movable active/archive root.
    const directory = join(home, "delivery-operation-locks");
    try {
      await mkdir(directory, { mode: 0o700 });
      await chmod(directory, 0o700);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await assertDirectory(directory, true);
    const digest = digestCanonical({ targetId: selection.targetId, deliveryId: selection.deliveryId });
    const path = join(directory, `sha256-${digest.slice("sha256:".length)}.lock`);
    const handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    try {
      const metadata = await handle.stat();
      const entry = await lstat(path);
      const uid = process.geteuid?.() ?? process.getuid?.();
      if (!metadata.isFile() || metadata.nlink !== 1 ||
          (uid !== undefined && metadata.uid !== uid) ||
          (metadata.mode & 0o7777) !== 0o600 ||
          !entry.isFile() || entry.isSymbolicLink() ||
          metadata.dev !== entry.dev || metadata.ino !== entry.ino) {
        fail("lock_file", "Delivery operation locking requires one exact private regular support file");
      }
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    fail("lock_support", "Delivery operation lock support could not be opened exactly");
  }
}

/**
 * Exclude overlapping operations for one exact Delivery, independently of
 * canonical Git and other Deliveries. Custody binds that selection to one Store.
 * Keep the support inode across Store creation, sealing, and archive: closing
 * the descriptor or losing its process releases ownership without unlinking it.
 */
export async function withDeliveryOperationLock<Value>(
  input: DeliveryOperationSelection,
  operation: string,
  action: () => Promise<Value>,
): Promise<Value> {
  const selection = Object.freeze({
    machineHome: input.machineHome,
    targetId: controlIdentifier(input.targetId, "Target identity"),
    deliveryId: controlIdentifier(input.deliveryId, "Delivery identity"),
  });
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(operation)) {
    fail("name", "Lifecycle operation identity is invalid");
  }
  const provider = foundationDescriptorLockProvider();
  if (provider === null) {
    fail("lock_unavailable", "Lifecycle has no installed descriptor-lock provider for this operating system");
  }
  const handle = await openDeliveryLock(selection);
  try {
    const acquired = spawnSync(provider.executable, provider.arguments, {
      env: {},
      stdio: ["ignore", "ignore", "ignore", handle.fd],
      windowsHide: true,
    });
    if (acquired.error || (acquired.status !== 0 && acquired.status !== provider.contentionExitCode)) {
      fail("lock_unavailable", "Lifecycle could not acquire the exact Delivery operation lock");
    }
    if (acquired.status === provider.contentionExitCode) {
      throw new FoundationError("operation.busy", "Another operation owns this Delivery; the requested operation did not start", {
        retryable: true,
        recoveryActions: [{ action: "retry", detail: "Retry after the active operation for this Delivery finishes." }],
        observedFacts: {
          operationDomain: "delivery",
          targetId: selection.targetId,
          deliveryId: selection.deliveryId,
        },
      });
    }
    return await action();
  } finally {
    await handle.close();
  }
}
