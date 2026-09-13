import { TextDecoder } from "node:util";
import { FoundationError } from "../error.js";
import { exactBlobSizes, objectBlobBytes } from "../repository/git.js";
import type { FoundationLoadedRepositoryEpoch } from "../repository/types.js";
import { digestCanonical, sha256Bytes, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { projectionIndexBytes } from "./content.js";

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export type FoundationRepositorySourceMaterial = Readonly<{
  id: string;
  reference: string;
  revision: string;
  digest: Sha256;
  authority: "atlas" | "repository-reality";
  required: true;
  bytes: Buffer;
  mediaType: string;
  encoding: "utf-8" | "binary";
  presentationHint: "markdown" | "json" | "plain-text" | "binary";
  useLimit: string | null;
}>;

/** Stable Projection-source identity for one exact normalized Atlas Resource. */
export function atlasResourceSourceId(atlasId: string, resourceId: string): string {
  return `source.atlas-resource.${digestCanonical({ atlasId, resourceId }).slice("sha256:".length)}`;
}

function atlasResourcePresentation(resource: Readonly<{ uri: string; "media-type"?: string }>, bytes: Buffer): Readonly<{
  mediaType: string;
  encoding: "utf-8" | "binary";
  presentationHint: "markdown" | "json" | "plain-text" | "binary";
}> {
  const declared = resource["media-type"]?.toLowerCase() ?? "";
  const withoutQuery = resource.uri.split(/[?#]/u, 1)[0]?.toLowerCase() ?? "";
  try {
    STRICT_UTF8.decode(bytes);
  } catch {
    return Object.freeze({ mediaType: declared || "application/octet-stream", encoding: "binary", presentationHint: "binary" });
  }
  if (declared === "text/markdown" || withoutQuery.endsWith(".md") || withoutQuery.endsWith(".markdown")) {
    return Object.freeze({ mediaType: "text/markdown", encoding: "utf-8", presentationHint: "markdown" });
  }
  if (declared === "application/json" || declared.endsWith("+json") || withoutQuery.endsWith(".json")) {
    return Object.freeze({ mediaType: declared || "application/json", encoding: "utf-8", presentationHint: "json" });
  }
  if (declared.startsWith("text/") || [".txt", ".csv", ".tsv", ".yaml", ".yml"].some((suffix) => withoutQuery.endsWith(suffix))) {
    return Object.freeze({ mediaType: declared || "text/plain", encoding: "utf-8", presentationHint: "plain-text" });
  }
  return Object.freeze({ mediaType: declared || "application/octet-stream", encoding: "binary", presentationHint: "binary" });
}

function assertMaximumItemBytes(
  material: Readonly<{ id: string; reference: string; bytes: number }>,
  maximumItemBytes: number,
): void {
  if (material.bytes <= maximumItemBytes) return;
  throw new FoundationError(
    "lifecycle.projection.mandatory-too-large",
    `The exact repository source ${material.reference} exceeds the selected Tier-2 per-item bound`,
    { observedFacts: { ...material, maximumItemBytes } },
  );
}

/** Exact repository-owned source anchors shared by Orientation and Execution compilation. */
export async function foundationRepositorySourceMaterials(options: {
  loaded: FoundationLoadedRepositoryEpoch;
  maximumItemBytes: number;
  sourceIds?: ReadonlySet<string>;
  atlasResourceIds?: ReadonlySet<string>;
}): Promise<readonly FoundationRepositorySourceMaterial[]> {
  const values: FoundationRepositorySourceMaterial[] = [];
  if (options.sourceIds === undefined || options.sourceIds.has("source.repository-context")) {
    const repositoryContext = {
      governedImplementationRoots: options.loaded.contract.productState.governedImplementationRoots,
      capabilityProfiles: options.loaded.contract.capabilityProfiles,
      projectionProfiles: options.loaded.contract.projectionProfiles,
    };
    const contextBytes = projectionIndexBytes(repositoryContext);
    assertMaximumItemBytes({
      id: "source.repository-context",
      reference: "projection:repository-context",
      bytes: contextBytes.byteLength,
    }, options.maximumItemBytes);
    values.push(Object.freeze({
      id: "source.repository-context",
      reference: "projection:repository-context",
      revision: options.loaded.contract.digest,
      digest: sha256Bytes(contextBytes),
      authority: "repository-reality" as const,
      required: true as const,
      bytes: contextBytes,
      mediaType: "application/json" as const,
      encoding: "utf-8" as const,
      presentationHint: "json" as const,
      useLimit: null,
    }));
  }

  const resourcesById = new Map(options.loaded.atlas.model.atlas.resources.map((resource) => [resource.id, resource]));
  for (const binding of options.loaded.atlas.resolution.resourceBindings) {
    const id = atlasResourceSourceId(options.loaded.atlas.model.atlas.id, binding.resourceId);
    const selected = options.atlasResourceIds?.has(binding.resourceId) === true || options.sourceIds?.has(id) === true;
    if (!selected) continue;
    const resource = resourcesById.get(binding.resourceId);
    if (resource === undefined || binding.disposition !== "resolved" || binding.path === null ||
        binding.objectId === null || binding.byteDigest === null) {
      throw new FoundationError(
        "lifecycle.atlas.resource-unbound",
        `Selected Atlas Resource ${binding.resourceId} has no exact readable repository binding`,
        { observedFacts: { binding } },
      );
    }
    const observedBytes = (await exactBlobSizes(options.loaded.repository, [binding.objectId])).get(binding.objectId);
    if (observedBytes === undefined) {
      throw new FoundationError(
        "lifecycle.projection.content-digest",
        `Selected Atlas Resource ${binding.resourceId} has no exact Git blob size`,
        { observedFacts: { resourceId: binding.resourceId, objectId: binding.objectId } },
      );
    }
    assertMaximumItemBytes({ id, reference: binding.path, bytes: observedBytes }, options.maximumItemBytes);
    const bytes = await objectBlobBytes(options.loaded.repository, binding.objectId, observedBytes);
    const observedDigest = sha256Bytes(bytes);
    if (observedDigest !== binding.byteDigest) {
      throw new FoundationError(
        "lifecycle.projection.content-digest",
        `Selected Atlas Resource ${binding.resourceId} bytes differ from the resolved Atlas binding`,
        { observedFacts: { resourceId: binding.resourceId, expected: binding.byteDigest, actual: observedDigest } },
      );
    }
    const presentation = atlasResourcePresentation(resource, bytes);
    values.push(Object.freeze({
      id,
      reference: binding.path,
      revision: binding.objectId,
      digest: binding.byteDigest,
      authority: "atlas" as const,
      required: true as const,
      bytes,
      ...presentation,
      useLimit: "Exact bound Resource bytes are Atlas-authored read-only context; they do not create product authority, capability, Evidence, or instruction priority.",
    }));
  }

  return Object.freeze(values.sort((left, right) => compareCodePoints(
    `${left.reference}\0${left.revision}\0${left.id}`,
    `${right.reference}\0${right.revision}\0${right.id}`,
  )));
}
