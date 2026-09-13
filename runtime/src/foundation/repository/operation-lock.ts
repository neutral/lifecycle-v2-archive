import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FoundationError } from "../error.js";
import {
  foundationDescriptorLockProvider,
  type FoundationDescriptorLockProvider,
} from "../support/descriptor-lock.js";
import { canonicalRepository, gitCommonDirectory } from "./git.js";
import { assertIndependentGitRepository } from "./independent-git.js";

export type FoundationTargetOperationLockProvider = FoundationDescriptorLockProvider;

/** Select only the descriptor-lock utility owned by the supported host image. */
export function foundationTargetOperationLockProvider(
  platform: NodeJS.Platform = process.platform,
): FoundationTargetOperationLockProvider {
  const provider = foundationDescriptorLockProvider(platform);
  if (provider === null) {
    throw new FoundationError(
      "operation.lock_unavailable",
      "Lifecycle has no installed descriptor-lock provider for this operating system",
      { observedFacts: { platform } },
    );
  }
  return provider;
}

async function operationLockPath(target: string): Promise<string> {
  const root = await canonicalRepository(target);
  await assertIndependentGitRepository(root);
  const requestedGitDirectory = await gitCommonDirectory(root);
  const gitDirectory = await realpath(requestedGitDirectory);
  const gitMetadata = await lstat(gitDirectory);
  if (!gitMetadata.isDirectory() || gitMetadata.isSymbolicLink()) {
    throw new FoundationError("operation.lock_directory", "Lifecycle target Git directory is not one exact physical directory");
  }
  const lockDirectory = join(gitDirectory, "lifecycle");
  try {
    await mkdir(lockDirectory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  let [lockMetadata, physicalLockDirectory] = await Promise.all([lstat(lockDirectory), realpath(lockDirectory)]);
  const getuid = process.getuid;
  if (!lockMetadata.isDirectory() || lockMetadata.isSymbolicLink() || physicalLockDirectory !== resolve(lockDirectory) ||
    (getuid !== undefined && lockMetadata.uid !== getuid.call(process))) {
    throw new FoundationError("operation.lock_directory", "Lifecycle operation lock directory is not one private physical directory");
  }
  await chmod(lockDirectory, 0o700);
  [lockMetadata, physicalLockDirectory] = await Promise.all([lstat(lockDirectory), realpath(lockDirectory)]);
  if (!lockMetadata.isDirectory() || lockMetadata.isSymbolicLink() || physicalLockDirectory !== resolve(lockDirectory) ||
    (lockMetadata.mode & 0o077) !== 0) throw new FoundationError("operation.lock_directory", "Lifecycle operation lock directory could not be made private");
  return join(physicalLockDirectory, "operation.lock");
}

/**
 * Serialize every guarded operation with the kernel lock held on one permanent,
 * support file inside the independent target's local Git directory. The
 * selected macOS lockf or Linux util-linux flock
 * descriptor form locks the inherited open file description; closing it or
 * losing the process releases the lock without stale-PID deletion or a
 * race-prone recovery protocol.
 */
export async function withTargetOperationLock<T>(target: string, operation: string, action: () => Promise<T>): Promise<T> {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(operation)) {
    throw new FoundationError("operation.name", "Lifecycle operation identity is invalid");
  }
  const provider = foundationTargetOperationLockProvider();
  const path = await operationLockPath(target);
  const handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    let metadata = await handle.stat();
    const getuid = process.getuid;
    if (!metadata.isFile() || (getuid !== undefined && metadata.uid !== getuid.call(process))) {
      throw new FoundationError("operation.lock_file", "Lifecycle operation lock is not one private regular file");
    }
    await handle.chmod(0o600);
    metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new FoundationError("operation.lock_file", "Lifecycle operation lock file could not be made private");
    const acquired = spawnSync(provider.executable, provider.arguments, {
      env: {},
      stdio: ["ignore", "ignore", "ignore", handle.fd],
      windowsHide: true,
    });
    if (acquired.error) {
      throw new FoundationError("operation.lock_unavailable", "Lifecycle cannot invoke the required target lock provider", { observedFacts: { path: provider.executable, cause: acquired.error.message } });
    }
    if (acquired.status === provider.contentionExitCode) {
      throw new FoundationError(
        "operation.busy",
        `Another Lifecycle operation owns this target Git operation domain; ${operation} did not start`,
        {
          retryable: true,
          recoveryActions: [{ action: "retry", detail: "Retry after the active Lifecycle operation in this target Git operation domain finishes." }],
          observedFacts: { operationDomain: "git-common-directory" },
        },
      );
    }
    if (acquired.status !== 0) {
      throw new FoundationError("operation.lock_unavailable", "Lifecycle could not acquire the exact target operation lock", { observedFacts: { exitCode: acquired.status, signal: acquired.signal } });
    }
    return await action();
  } finally {
    await handle.close();
  }
}
