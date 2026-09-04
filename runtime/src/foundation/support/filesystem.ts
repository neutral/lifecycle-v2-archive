import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Create one runtime-private directory hierarchy and enforce its selected mode. */
export async function ensureDirectory(path: string, mode = 0o700): Promise<void> {
  await mkdir(path, { recursive: true, mode });
  await chmod(path, mode).catch(() => undefined);
}

/**
 * Replace one file through an exclusive sibling temporary, durable file sync,
 * atomic rename, and durable parent-directory sync.
 */
export async function atomicWrite(path: string, content: string | Uint8Array, mode = 0o600): Promise<void> {
  const parent = dirname(path);
  await ensureDirectory(parent);
  const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", mode);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
  await rename(temporary, path);
  const directory = await open(parent, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
