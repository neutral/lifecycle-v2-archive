import { FoundationError } from "../error.js";
import type { FoundationAtlasState, FoundationGitTreeEntry } from "../repository/types.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import { selfDigest } from "../validation/canonical.js";
import { materializeAtlasState } from "./materialization.js";
import { processMaterializedAtlas } from "./processor.js";
import { bindAtlasResources } from "./resources.js";
import { FOUNDATION_ATLAS_PROCESSOR, FOUNDATION_ATLAS_SELECTION } from "./selection.js";
import type { FoundationAtlasResolution, FoundationResolvedAtlas } from "./types.js";

const ATLAS_RESOLUTION_SCHEMA_ID = "urn:lifecycle:schema:atlas-resolution:v2";

export async function resolveAtlas(options: {
  repository: string;
  entrypoint: string;
  atlasState: FoundationAtlasState;
  treeEntries: readonly FoundationGitTreeEntry[];
}): Promise<FoundationResolvedAtlas> {
  const materialization = await materializeAtlasState(
    options.repository,
    options.atlasState,
    options.entrypoint,
  );
  try {
    const processed = await processMaterializedAtlas(materialization.entrypoint);
    const resources = await bindAtlasResources({
      repository: options.repository,
      model: processed.model,
      atlasState: options.atlasState,
      treeEntries: options.treeEntries,
    });
    const subject = {
      schema: "lifecycle.atlas-resolution.v2" as const,
      selection: FOUNDATION_ATLAS_SELECTION,
      atlasStateDigest: options.atlasState.digest,
      resourceBindings: resources.bindings,
      resourceBindingsDigest: resources.digest,
      processor: FOUNDATION_ATLAS_PROCESSOR,
      externalValidationResultDigest: processed.resultDigest,
      normalizedModelDigest: processed.modelDigest,
      complete: true as const,
      valid: true as const,
    };
    const resolution: FoundationAtlasResolution = Object.freeze({
      ...subject,
      digest: selfDigest(subject),
    });
    assertFoundationSchema(ATLAS_RESOLUTION_SCHEMA_ID, resolution, "Atlas Resolution");
    return Object.freeze({ resolution, validationResult: processed.result, model: processed.model });
  } catch (error) {
    if (error instanceof FoundationError && error.code.startsWith("lifecycle.atlas.")) throw error;
    throw new FoundationError("lifecycle.atlas.processing-incomplete", "Atlas resolution did not complete");
  } finally {
    await materialization.cleanup();
  }
}
