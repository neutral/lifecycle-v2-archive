import type { ControlJsonObject, ControlJsonValue, ControlRecordRevision } from "../control/types.js";
import { FoundationError } from "../error.js";
import type {
  FoundationKnowledgeSet,
  FoundationKnowledgeSourceResolution,
} from "../knowledge/types.js";
import type { FoundationLoadedRepositorySnapshot } from "../repository/types.js";
import type { Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { atlasResourceSourceId } from "./source-context.js";
import type { FoundationProjectionSourceRoot } from "./types.js";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.operation-context-v7.${code}`, message, {
    observedFacts,
  });
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("retained-fact", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function array(value: ControlJsonValue | undefined, label: string): readonly ControlJsonValue[] {
  if (!Array.isArray(value)) fail("retained-fact", `${label} must be one exact array`);
  return value;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    fail("retained-fact", `${label} must be bounded normalized text`);
  }
  return value;
}

function nullableString(value: ControlJsonValue | undefined, label: string): string | null {
  return value === null ? null : string(value, label);
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = string(value, label);
  if (!SHA256_PATTERN.test(selected)) fail("retained-fact", `${label} must be one SHA-256 digest`);
  return selected as Sha256;
}

function authorityForSource(
  source: FoundationKnowledgeSourceResolution,
): "atlas" | "informational-source" | "repository-reality" {
  return source.kind === "atlas" ? "atlas"
    : source.kind === "repository" ? "repository-reality"
      : "informational-source";
}

/** Compile the exact external-source roots retained by one admitted Work Boundary. */
export function compileExecutionProjectionSourceRoots(options: Readonly<{
  boundary: ControlRecordRevision;
  knowledge: FoundationKnowledgeSet;
  snapshot: FoundationLoadedRepositorySnapshot;
}>): readonly FoundationProjectionSourceRoot[] {
  const selected = array(options.boundary.payload.externalSources, "Work Boundary external sources");
  return Object.freeze(selected.map((value, index) => {
    const source = object(value, `Work Boundary external source[${index}]`);
    const sourceId = string(source.sourceId, `Work Boundary external source[${index}] identity`);
    const revision = nullableString(source.revision, `Work Boundary external source[${index}] revision`);
    const selectedDigest = digest(source.digest, `Work Boundary external source[${index}] digest`);
    const ownerKind = string(source.ownerKind, `Work Boundary external source[${index}] owner kind`);
    const ownerId = string(source.ownerId, `Work Boundary external source[${index}] owner identity`);
    const matches = options.knowledge.sources.filter((candidate) =>
      candidate.sourceId === sourceId && candidate.declaredRevision === revision &&
      (candidate.resolvedDigest ?? candidate.declaredDigest) === selectedDigest &&
      authorityForSource(candidate) === ownerKind);
    const atlasResourceMatches = ownerKind !== "atlas" ? [] :
      options.snapshot.atlas.model.atlas.resources.flatMap((resource) => {
        const materialId = atlasResourceSourceId(options.snapshot.atlas.model.atlas.id, resource.id);
        const binding = options.snapshot.atlas.resolution.resourceBindings.find(
          ({ resourceId }) => resourceId === resource.id,
        );
        return materialId === sourceId && materialId === ownerId &&
            binding?.disposition === "resolved" && binding.path !== null &&
            binding.objectId === revision && binding.byteDigest === selectedDigest
          ? [Object.freeze({ resource, binding, materialId })]
          : [];
      });
    if (matches.length + atlasResourceMatches.length !== 1) {
      fail("source", `Work Boundary external source ${sourceId} does not resolve one exact Knowledge source`, {
        knowledgeMatches: matches.length,
        atlasResourceMatches: atlasResourceMatches.length,
      });
    }
    const atlasResource = atlasResourceMatches[0];
    if (atlasResource !== undefined) {
      return Object.freeze({
        owner: "source-anchor" as const,
        sourceId: atlasResource.materialId,
        reference: atlasResource.binding.path!,
        revision: atlasResource.binding.objectId,
        digest: selectedDigest,
        authority: "atlas" as const,
        required: true,
        reason: "selected-by-active-work-boundary",
      });
    }
    const match = matches[0]!;
    return Object.freeze({
      owner: "knowledge" as const,
      recordId: match.recordId,
      recordRevision: match.recordRevision,
      sourceId: match.sourceId,
      reference: match.reference,
      revision: match.declaredRevision,
      digest: selectedDigest,
      authority: authorityForSource(match),
      required: match.required,
      reason: "selected-by-active-work-boundary",
    });
  }).sort((left, right) => compareCodePoints(
    left.owner === "knowledge"
      ? `knowledge\0${left.recordId}\0${left.recordRevision}\0${left.sourceId}`
      : `source-anchor\0${left.sourceId}`,
    right.owner === "knowledge"
      ? `knowledge\0${right.recordId}\0${right.recordRevision}\0${right.sourceId}`
      : `source-anchor\0${right.sourceId}`,
  )));
}
