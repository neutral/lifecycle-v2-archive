import {
  INTEGRATION_CONTEXT_SUBJECTS,
  type FoundationIntegrationApplicabilityV1,
  type FoundationIntegrationContextSubjectV1,
} from "../control/integration-assessment.js";
import type { ControlRecordRevision } from "../control/types.js";
import { FoundationError } from "../error.js";
import { knowledgeRevisionIdentity } from "../knowledge/identity.js";
import type { FoundationKnowledgeSet } from "../knowledge/types.js";
import type { FoundationLoadedRepositorySnapshot } from "../repository/types.js";
import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { foundationIntegrationClosureV1 } from "./execution-closure.js";
import { atlasExecutionGoverningFacts } from "./atlas-execution-closure.js";
import { atlasResourceSourceId } from "./source-context.js";

type Context = Readonly<{ loaded: FoundationLoadedRepositorySnapshot; knowledge: FoundationKnowledgeSet }>;

function boundarySources(boundary: ControlRecordRevision) {
  const entries = boundary.payload.externalSources;
  if (!Array.isArray(entries)) throw new FoundationError("lifecycle.projection.control-invalid", "Boundary external sources must be an array");
  return entries.map((entry) => {
    if (entry === null || Array.isArray(entry) || typeof entry !== "object" ||
        typeof entry.sourceId !== "string" || typeof entry.ownerKind !== "string" || typeof entry.ownerId !== "string") {
      throw new FoundationError("lifecycle.projection.control-invalid", "Boundary source must carry exact source and owner identities");
    }
    return { selected: entry, sourceId: entry.sourceId, ownerKind: entry.ownerKind, ownerId: entry.ownerId };
  });
}

function selectedDisciplineFacts(boundary: ControlRecordRevision, knowledge: FoundationKnowledgeSet): unknown {
  const selection = boundary.payload.disciplines;
  if (selection === null || Array.isArray(selection) || typeof selection !== "object" ||
      !("records" in selection) || !Array.isArray(selection.records)) {
    throw new FoundationError("lifecycle.projection.control-invalid", "Boundary must carry its exact Discipline selection");
  }
  return selection.records.map((record) => {
    if (record === null || Array.isArray(record) || typeof record !== "object" || typeof record.id !== "string") {
      throw new FoundationError("lifecycle.projection.control-invalid", "Selected Discipline requires an identity");
    }
    const adoption = knowledge.disciplineRegistry.adoptions.find(({ id }) => id === record.id) ?? null;
    return { id: record.id, adoption, pack: adoption === null ? null :
      knowledge.disciplineRegistry.packs.find(({ id }) => id === adoption.packId) ?? null };
  });
}

function fingerprint(subject: FoundationIntegrationContextSubjectV1, value: unknown): Sha256 {
  return digestCanonical({ rule: "lifecycle.integration.three-way.v2", subject, value });
}

function closureFacts(boundary: ControlRecordRevision, context: Context, currentRoots: boolean) {
  const selected = foundationIntegrationClosureV1({ ...context, boundary, currentRoots });
  const records = [...selected.closure.values()].map(({ record }) => record)
    .sort((left, right) => compareCodePoints(left.frontMatter.id, right.frontMatter.id));
  const ids = new Set(records.map(({ frontMatter }) => frontMatter.id));
  const selectedSources = boundarySources(boundary);
  const explicitSourceIds = new Set(selectedSources.map(({ sourceId }) => sourceId));
  const sources = context.knowledge.sources.filter((source) =>
    context.knowledge.index.currentByIdentity.get(source.recordId)?.frontMatter.revision === source.recordRevision &&
    (ids.has(source.recordId) && source.required || explicitSourceIds.has(source.sourceId)))
    .map(({ locator: _locator, ...source }) => source)
    .sort((left, right) => compareCodePoints(`${left.recordId}\0${left.sourceId}`, `${right.recordId}\0${right.sourceId}`));
  // Required external selections also include exact absence. Missing sources
  // cannot disappear from the comparison merely because no record resolved.
  const explicit = selectedSources.map((source) => ({
    selected: source.selected,
    matches: sources.filter(({ sourceId }) => sourceId === source.sourceId),
    atlasResources: source.ownerKind === "atlas"
      ? context.loaded.atlas.resolution.resourceBindings.filter(({ resourceId }) =>
          source.sourceId === atlasResourceSourceId(context.loaded.atlas.model.atlas.id, resourceId) ||
          source.ownerId === atlasResourceSourceId(context.loaded.atlas.model.atlas.id, resourceId))
      : [],
  }));
  return {
    closure: {
      records: records.map((record) => ({ ...knowledgeRevisionIdentity(record), path: record.path, kind: record.frontMatter.kind })),
      relationships: context.knowledge.relationships.filter(({ source, target, sourceRevision }) =>
        ids.has(source) && ids.has(target) &&
        context.knowledge.index.currentByIdentity.get(source)?.frontMatter.revision === sourceRevision),
      conflicts: context.knowledge.conflicts.filter(({ leftId, rightId }) => ids.has(leftId) || ids.has(rightId)),
      bindings: context.knowledge.manifest.bindings.filter(({ checkId }) => ids.has(checkId)),
      // Selected Description bytes bind ownership selectors; the contract binds
      // exemption policy. Snapshot validation owns per-file coverage facts,
      // including blob identities and matched exemptions, whose movement alone
      // does not change the governing meaning selected by this closure.
    },
    sources: { required: sources, explicit },
  };
}

/** Exact selected-content comparison; neither full Knowledge Set identity nor live HEAD is the oracle. */
export function compareFoundationIntegrationContextV1(input: Readonly<{
  boundary: ControlRecordRevision;
  admitted: Context;
  parent: Context;
}>): FoundationIntegrationApplicabilityV1 {
  const admitted = closureFacts(input.boundary, input.admitted, false);
  let parent: ReturnType<typeof closureFacts> | Readonly<{ closure: unknown; sources: unknown }>;
  try {
    parent = closureFacts(input.boundary, input.parent, true);
  } catch (error) {
    if (!(error instanceof FoundationError) || ![
      "lifecycle.projection.root-unresolved", "lifecycle.projection.bounds-invalid",
      "lifecycle.projection.description-missing", "lifecycle.projection.description-ambiguous",
      "lifecycle.projection.profile-unsupported",
    ].includes(error.code)) throw error;
    const missing = Object.freeze({ disposition: "unresolved", code: error.code });
    parent = Object.freeze({ closure: missing, sources: missing });
  }
  const facts = (context: Context, closure: typeof parent): Record<FoundationIntegrationContextSubjectV1, unknown> => ({
    "repository-contract": context.loaded.snapshot.contractDigest,
    atlas: atlasExecutionGoverningFacts({ loaded: context.loaded, sourceRoots: boundarySources(input.boundary)
      .map(({ sourceId, ownerKind }) => ({ sourceId, authority: ownerKind === "atlas" ? "atlas" as const : "informational-source" as const })) }),
    "discipline-registry": selectedDisciplineFacts(input.boundary, context.knowledge),
    "knowledge-closure": closure.closure,
    "required-sources": closure.sources,
  });
  const admittedFacts = facts(input.admitted, admitted);
  const parentFacts = facts(input.parent, parent);
  const changes = INTEGRATION_CONTEXT_SUBJECTS.flatMap((subject) => {
    const admittedDigest = fingerprint(subject, admittedFacts[subject]);
    const parentDigest = fingerprint(subject, parentFacts[subject]);
    return admittedDigest === parentDigest ? [] : [Object.freeze({ subject, admittedDigest, parentDigest })];
  });
  return Object.freeze({ disposition: changes.length === 0 ? "unchanged" : "requires-readmission", changes: Object.freeze(changes) });
}
