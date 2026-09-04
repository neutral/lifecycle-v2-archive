import { performance } from "node:perf_hooks";
import { posix } from "node:path";
import { FoundationError } from "../error.js";
import { objectBlobBytes } from "../repository/git.js";
import type { FoundationAtlasState, FoundationGitTreeEntry } from "../repository/types.js";
import { digestCanonical, sha256Bytes, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { FOUNDATION_ATLAS_RESOURCE_BINDING_LIMITS } from "./limits.js";
import type {
  FoundationAtlasNormalizedModel,
  FoundationAtlasResourceBinding,
} from "./types.js";

export type FoundationAtlasResourceBindingLimits = Readonly<{
  maximumResources: number;
  maximumResourceBytes: number;
  maximumAggregateBytes: number;
  maximumElapsedMilliseconds: number;
}>;

export type FoundationAtlasResourceBindingHost = Readonly<{
  now(): number;
  readBlob(repository: string, objectId: string, maximumBytes: number, timeoutMs: number): Promise<Buffer>;
}>;

const SYSTEM_RESOURCE_BINDING_HOST: FoundationAtlasResourceBindingHost = Object.freeze({
  now: () => performance.now(),
  readBlob: objectBlobBytes,
});

function repositoryPath(uri: string): string | null | undefined {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(uri) || uri.startsWith("//")) return null;
  const pathPart = uri.split(/[?#]/u, 1)[0];
  if (pathPart === undefined || pathPart.length === 0) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return undefined;
  }
  if (decoded.includes("\\") || decoded.includes("\0") || posix.isAbsolute(decoded)) return undefined;
  const path = posix.normalize(posix.join("atlas", decoded));
  if (path === ".." || path.startsWith("../") || path === ".") return undefined;
  return path;
}

function processingBound(message: string, maximum: number): FoundationError {
  return new FoundationError("lifecycle.atlas.processing-incomplete", message, {
    observedFacts: { maximum },
  });
}

function compareBindings(left: FoundationAtlasResourceBinding, right: FoundationAtlasResourceBinding): number {
  return compareCodePoints(left.resourceId, right.resourceId) ||
    compareCodePoints(left.uri, right.uri) ||
    compareCodePoints(left.path ?? "", right.path ?? "");
}

/**
 * Bind registered Resources under one explicit policy and host. The exported
 * seam keeps the boundary mechanics directly testable; production calls use
 * the fixed Foundation limits and system host below.
 */
export async function bindAtlasResourcesUnderPolicy(options: {
  repository: string;
  model: FoundationAtlasNormalizedModel;
  atlasState: FoundationAtlasState;
  treeEntries: readonly FoundationGitTreeEntry[];
}, host: FoundationAtlasResourceBindingHost, limits: FoundationAtlasResourceBindingLimits): Promise<Readonly<{
  bindings: readonly FoundationAtlasResourceBinding[];
  digest: ReturnType<typeof digestCanonical>;
}>> {
  const startedAt = host.now();
  const resources = options.model.atlas.resources;
  if (resources.length > limits.maximumResources) {
    throw processingBound(
      "Atlas Resource registration exceeds the binding count bound",
      limits.maximumResources,
    );
  }
  const resourceIds = new Set<string>();
  for (const resource of resources) {
    if (resourceIds.has(resource.id)) {
      throw new FoundationError(
        "lifecycle.atlas.result-invalid",
        "Resolved Atlas contains duplicate Resource identities",
      );
    }
    resourceIds.add(resource.id);
  }

  const elapsed = (): number => host.now() - startedAt;
  const remainingMilliseconds = (): number => {
    const observed = elapsed();
    if (!Number.isFinite(observed) || observed < 0 || observed >= limits.maximumElapsedMilliseconds) {
      throw processingBound(
        "Atlas Resource binding exceeded its elapsed-time bound",
        limits.maximumElapsedMilliseconds,
      );
    }
    return Math.max(1, Math.ceil(limits.maximumElapsedMilliseconds - observed));
  };

  const treeByPath = new Map(options.treeEntries.map((entry) => [entry.path, entry]));
  const blobs = new Map<string, Readonly<{ digest: Sha256 }> | null>();
  const bindings: FoundationAtlasResourceBinding[] = [];
  let aggregateBytes = 0;
  for (const resource of resources) {
    remainingMilliseconds();
    const path = repositoryPath(resource.uri);
    if (path === null) {
      bindings.push(Object.freeze({
        resourceId: resource.id,
        uri: resource.uri,
        path: null,
        mode: null,
        objectId: null,
        byteDigest: null,
        disposition: "retrieval-denied",
      }));
      continue;
    }
    if (path === undefined) {
      bindings.push(Object.freeze({
        resourceId: resource.id,
        uri: resource.uri,
        path: null,
        mode: null,
        objectId: null,
        byteDigest: null,
        disposition: "path-invalid",
      }));
      continue;
    }
    const entry = treeByPath.get(path);
    if (entry === undefined) {
      bindings.push(Object.freeze({
        resourceId: resource.id,
        uri: resource.uri,
        path,
        mode: null,
        objectId: null,
        byteDigest: null,
        disposition: "missing",
      }));
      continue;
    }
    if (entry.type !== "blob" || entry.mode !== "100644") {
      bindings.push(Object.freeze({
        resourceId: resource.id,
        uri: resource.uri,
        path,
        mode: null,
        objectId: null,
        byteDigest: null,
        disposition: "unreadable",
      }));
      continue;
    }

    let blob = blobs.get(entry.objectId);
    if (blob === undefined) {
      try {
        const bytes = await host.readBlob(
          options.repository,
          entry.objectId,
          limits.maximumResourceBytes,
          remainingMilliseconds(),
        );
        remainingMilliseconds();
        if (bytes.byteLength > limits.maximumResourceBytes) {
          blob = null;
        } else {
          aggregateBytes += bytes.byteLength;
          if (aggregateBytes > limits.maximumAggregateBytes) {
            throw processingBound(
              "Atlas Resource binding exceeds the aggregate-byte bound",
              limits.maximumAggregateBytes,
            );
          }
          blob = Object.freeze({ digest: sha256Bytes(bytes) });
        }
      } catch (error) {
        if (
          error instanceof FoundationError &&
          (error.code === "lifecycle.atlas.processing-incomplete" || error.code === "lifecycle.repository.blob-timeout")
        ) {
          throw error.code === "lifecycle.atlas.processing-incomplete"
            ? error
            : processingBound(
              "Atlas Resource binding exceeded its elapsed-time bound",
              limits.maximumElapsedMilliseconds,
            );
        }
        if (!(error instanceof FoundationError)) {
          throw new FoundationError(
            "lifecycle.atlas.processing-incomplete",
            "Atlas Resource binding did not complete",
          );
        }
        remainingMilliseconds();
        blob = null;
      }
      blobs.set(entry.objectId, blob);
    }
    if (blob === null) {
      bindings.push(Object.freeze({
        resourceId: resource.id,
        uri: resource.uri,
        path,
        mode: null,
        objectId: null,
        byteDigest: null,
        disposition: "unreadable",
      }));
      continue;
    }
    bindings.push(Object.freeze({
      resourceId: resource.id,
      uri: resource.uri,
      path,
      mode: "100644",
      objectId: entry.objectId,
      byteDigest: blob.digest,
      disposition: "resolved",
    }));
  }
  remainingMilliseconds();
  bindings.sort(compareBindings);
  const frozen = Object.freeze(bindings);
  return Object.freeze({ bindings: frozen, digest: digestCanonical(frozen) });
}

/** Bind every registered Resource without treating its URI as read authority. */
export async function bindAtlasResources(options: {
  repository: string;
  model: FoundationAtlasNormalizedModel;
  atlasState: FoundationAtlasState;
  treeEntries: readonly FoundationGitTreeEntry[];
}): Promise<Readonly<{
  bindings: readonly FoundationAtlasResourceBinding[];
  digest: ReturnType<typeof digestCanonical>;
}>> {
  return await bindAtlasResourcesUnderPolicy(
    options,
    SYSTEM_RESOURCE_BINDING_HOST,
    FOUNDATION_ATLAS_RESOURCE_BINDING_LIMITS,
  );
}
