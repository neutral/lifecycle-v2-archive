import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { FoundationError } from "../error.js";
import { sha256Bytes } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { FOUNDATION_ATLAS_PROCESSOR_INVENTORY_LIMITS } from "./limits.js";
import type { FoundationAtlasProcessorFile } from "./processor-inventory.js";

export type FoundationAtlasProcessorInventoryLimits = Readonly<{
  maximumEntries: number;
  maximumDepth: number;
  maximumFileBytes: number;
  maximumAggregateBytes: number;
  maximumElapsedMilliseconds: number;
}>;

type ProcessorInventoryFile = Readonly<{
  physicalPath: string;
  relativePath: string;
  mode: FoundationAtlasProcessorFile["mode"];
  byteLength: number;
}>;

const PROCESSOR_INVENTORY_ROOTS = Object.freeze([
  "README.md",
  "bin",
  "package.json",
  "schemas",
  "src",
] as const);

function unavailable(message: string, maximum?: number): FoundationError {
  return new FoundationError("lifecycle.atlas.processor-unavailable", message, {
    ...(maximum === undefined ? {} : { observedFacts: { maximum } }),
  });
}

function installedMode(mode: number): "000644" | "000755" {
  const value = (mode & 0o777).toString(8).padStart(6, "0");
  if (value !== "000644" && value !== "000755") {
    throw unavailable("Installed Atlas processor contains a file with an unsupported mode");
  }
  return value;
}

function validateLimits(limits: FoundationAtlasProcessorInventoryLimits): void {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw unavailable("Installed Atlas processor inventory policy is invalid");
    }
  }
}

/**
 * Inventory an installed processor through a bounded two-phase traversal.
 * Traversal establishes all count, depth, and declared-size bounds before any
 * file payload is opened; the second phase reads each exact non-symlink file.
 */
export async function inventoryInstalledAtlasProcessor(
  root: string,
  limits: FoundationAtlasProcessorInventoryLimits = FOUNDATION_ATLAS_PROCESSOR_INVENTORY_LIMITS,
  now: () => number = () => performance.now(),
): Promise<readonly FoundationAtlasProcessorFile[]> {
  validateLimits(limits);
  const startedAt = now();
  const remainingMilliseconds = (): number => {
    const elapsed = now() - startedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= limits.maximumElapsedMilliseconds) {
      throw unavailable(
        "Installed Atlas processor inventory exceeded its elapsed-time bound",
        limits.maximumElapsedMilliseconds,
      );
    }
    return Math.max(1, Math.ceil(limits.maximumElapsedMilliseconds - elapsed));
  };
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    const timeoutMs = remainingMilliseconds();
    let timeout: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(unavailable(
            "Installed Atlas processor inventory exceeded its elapsed-time bound",
            limits.maximumElapsedMilliseconds,
          )), timeoutMs);
          timeout.unref();
        }),
      ]);
      remainingMilliseconds();
      return result;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };

  try {
    let discoveredEntries = PROCESSOR_INVENTORY_ROOTS.length;
    if (discoveredEntries > limits.maximumEntries) {
      throw unavailable(
        "Installed Atlas processor inventory exceeds its entry-count bound",
        limits.maximumEntries,
      );
    }
    let aggregateBytes = 0;
    const files: ProcessorInventoryFile[] = [];

    const visit = async (physicalPath: string, relativePath: string, depth: number): Promise<void> => {
      remainingMilliseconds();
      if (depth > limits.maximumDepth) {
        throw unavailable(
          "Installed Atlas processor inventory exceeds its depth bound",
          limits.maximumDepth,
        );
      }
      const metadata = await bounded(async () => await lstat(physicalPath));
      if (metadata.isSymbolicLink()) {
        throw unavailable("Installed Atlas processor contains a symbolic link");
      }
      if (metadata.isDirectory()) {
        const directory = await bounded(async () => await opendir(physicalPath));
        const children: string[] = [];
        try {
          while (true) {
            const child = await bounded(async () => await directory.read());
            if (child === null) break;
            discoveredEntries += 1;
            if (discoveredEntries > limits.maximumEntries) {
              throw unavailable(
                "Installed Atlas processor inventory exceeds its entry-count bound",
                limits.maximumEntries,
              );
            }
            children.push(child.name);
          }
        } finally {
          await bounded(async () => await directory.close());
        }
        children.sort(compareCodePoints);
        for (const child of children) {
          await visit(join(physicalPath, child), `${relativePath}/${child}`, depth + 1);
        }
        return;
      }
      if (!metadata.isFile()) {
        throw unavailable("Installed Atlas processor contains an unsupported filesystem entry");
      }
      if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > limits.maximumFileBytes) {
        throw unavailable(
          "Installed Atlas processor contains a file that exceeds its byte bound",
          limits.maximumFileBytes,
        );
      }
      aggregateBytes += metadata.size;
      if (aggregateBytes > limits.maximumAggregateBytes) {
        throw unavailable(
          "Installed Atlas processor inventory exceeds its aggregate-byte bound",
          limits.maximumAggregateBytes,
        );
      }
      files.push(Object.freeze({
        physicalPath,
        relativePath,
        mode: installedMode(metadata.mode),
        byteLength: metadata.size,
      }));
    };

    for (const selected of PROCESSOR_INVENTORY_ROOTS) {
      await visit(join(root, selected), selected, 1);
    }

    files.sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
    const records: FoundationAtlasProcessorFile[] = [];
    for (const file of files) {
      const handle = await bounded(async () => await open(file.physicalPath, constants.O_RDONLY | constants.O_NOFOLLOW));
      try {
        const current = await bounded(async () => await handle.stat());
        if (
          !current.isFile() ||
          current.size !== file.byteLength ||
          installedMode(current.mode) !== file.mode
        ) {
          throw unavailable("Installed Atlas processor changed during inventory");
        }
        const bytes = await bounded(async () => await handle.readFile());
        if (bytes.byteLength !== file.byteLength) {
          throw unavailable("Installed Atlas processor changed during inventory");
        }
        records.push(Object.freeze({
          path: file.relativePath,
          mode: file.mode,
          byteLength: bytes.byteLength,
          sha256: sha256Bytes(bytes),
        }));
      } finally {
        await bounded(async () => await handle.close());
      }
    }
    remainingMilliseconds();
    return Object.freeze(records);
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    throw unavailable("The selected Atlas processor inventory is unavailable");
  }
}
