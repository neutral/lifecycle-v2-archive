import type {
  FoundationAtlasContentTarget,
  FoundationAtlasMap,
  FoundationAtlasPoint,
  FoundationAtlasPointRecord,
  FoundationAtlasReference,
} from "../atlas/types.js";
import type { FoundationLoadedRepositoryEpoch } from "../repository/types.js";
import { compareCodePoints } from "../validation/ordering.js";
import { atlasResourceSourceId } from "./source-context.js";
import type { FoundationProjectionSourceRoot } from "./types.js";

export type FoundationAtlasExecutionClosurePlan = Readonly<{
  mapIds: ReadonlySet<string>;
  pointIds: ReadonlySet<string>;
  pointRecordKeys: ReadonlySet<string>;
  resourceIds: ReadonlySet<string>;
  mapReasons: ReadonlyMap<string, ReadonlySet<string>>;
  pointRecordReasons: ReadonlyMap<string, ReadonlySet<string>>;
  resourceReasons: ReadonlyMap<string, ReadonlySet<string>>;
}>;

type AtlasTarget = FoundationAtlasContentTarget | FoundationAtlasReference;

function targetsForMap(map: FoundationAtlasMap): readonly AtlasTarget[] {
  return Object.freeze([
    ...map.content,
    ...map.references,
    ...map.areas.flatMap((area) => [...(area.content ?? []), ...(area.references ?? [])]),
  ]);
}

function targetsForRecord(record: FoundationAtlasPointRecord): readonly AtlasTarget[] {
  return Object.freeze([...record.content, ...record.references]);
}

function referencedResourceIds(options: Readonly<{
  targets: readonly AtlasTarget[];
  resourceIds: ReadonlySet<string>;
  resourceIdsByUri: ReadonlyMap<string, readonly string[]>;
}>): readonly string[] {
  const selected = new Set<string>();
  for (const target of options.targets) {
    if (target.resource !== undefined && options.resourceIds.has(target.resource)) {
      selected.add(target.resource);
    }
    if (target.uri !== undefined) {
      for (const id of options.resourceIdsByUri.get(target.uri) ?? []) selected.add(id);
    }
  }
  return Object.freeze([...selected].sort(compareCodePoints));
}

function freezeReasonMap(
  value: ReadonlyMap<string, Set<string>>,
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map([...value].map(([id, reasons]) => [id, new Set(reasons)]));
}

export function atlasPointRecordKey(
  point: Pick<FoundationAtlasPoint, "id">,
  record: Pick<FoundationAtlasPointRecord, "map" | "kind" | "path">,
): string {
  return `${point.id}\0${record.map}\0${record.kind}\0${record.path}`;
}

/** Resolve exact Atlas Resource identities retained by admitted Boundary source roots. */
export function atlasResourceIdsForSourceRoots(
  loaded: FoundationLoadedRepositoryEpoch,
  roots: readonly Pick<FoundationProjectionSourceRoot, "sourceId" | "authority">[],
): ReadonlySet<string> {
  const atlasId = loaded.atlas.model.atlas.id;
  const bySourceId = new Map(loaded.atlas.model.atlas.resources.map((resource) =>
    [atlasResourceSourceId(atlasId, resource.id), resource.id]));
  const selected = new Set<string>();
  for (const root of roots) {
    if (root.authority !== "atlas") continue;
    const resourceId = bySourceId.get(root.sourceId);
    if (resourceId !== undefined) selected.add(resourceId);
  }
  return selected;
}

/**
 * Compute the exact fixed point selected by one Execution Projection.
 *
 * This planner selects semantic identities and inclusion reasons only. It does
 * not materialize bytes, construct Projection items, or mutate Runtime truth.
 */
export function planAtlasExecutionClosure(options: Readonly<{
  loaded: FoundationLoadedRepositoryEpoch;
  sourceRoots?: readonly Pick<FoundationProjectionSourceRoot, "sourceId" | "authority">[];
  selectedResourceIds?: ReadonlySet<string>;
}>): FoundationAtlasExecutionClosurePlan {
  const model = options.loaded.atlas.model;
  const allResourceIds = new Set(model.atlas.resources.map(({ id }) => id));
  const resourceIdsByUri = new Map<string, string[]>();
  for (const resource of model.atlas.resources) {
    const ids = resourceIdsByUri.get(resource.uri) ?? [];
    ids.push(resource.id);
    resourceIdsByUri.set(resource.uri, ids);
  }
  for (const ids of resourceIdsByUri.values()) ids.sort(compareCodePoints);

  const mapIds = new Set<string>();
  const pointIds = new Set<string>();
  const pointRecordKeys = new Set<string>();
  const resourceIds = new Set<string>();
  const mapReasons = new Map<string, Set<string>>();
  const pointRecordReasons = new Map<string, Set<string>>();
  const resourceReasons = new Map<string, Set<string>>();
  const addReason = (registry: Map<string, Set<string>>, id: string, reason: string): boolean => {
    const reasons = registry.get(id) ?? new Set<string>();
    const before = reasons.size;
    reasons.add(reason);
    registry.set(id, reasons);
    return before === 0;
  };
  const selectResource = (id: string, reason: string): boolean => {
    if (!allResourceIds.has(id)) return false;
    const added = !resourceIds.has(id);
    resourceIds.add(id);
    addReason(resourceReasons, id, reason);
    return added;
  };
  const selectMap = (id: string, reason: string): boolean => {
    const added = !mapIds.has(id);
    mapIds.add(id);
    addReason(mapReasons, id, reason);
    return added;
  };
  const selectRecord = (
    point: FoundationAtlasPoint,
    record: FoundationAtlasPointRecord,
    reason: string,
  ): boolean => {
    const key = atlasPointRecordKey(point, record);
    const added = !pointRecordKeys.has(key);
    pointRecordKeys.add(key);
    pointIds.add(point.id);
    addReason(pointRecordReasons, key, reason);
    selectMap(record.map, `contains-selected-point-record:${point.id}`);
    return added;
  };

  const seeds = new Set(options.selectedResourceIds ?? []);
  if (options.sourceRoots !== undefined) {
    for (const id of atlasResourceIdsForSourceRoots(options.loaded, options.sourceRoots)) {
      seeds.add(id);
    }
  }
  for (const id of seeds) selectResource(id, "active-work-boundary-source-root");

  let changed = true;
  while (changed) {
    changed = false;
    for (const map of model.maps) {
      const referenced = referencedResourceIds({
        targets: targetsForMap(map),
        resourceIds: allResourceIds,
        resourceIdsByUri,
      });
      if (mapIds.has(map.id)) {
        for (const id of referenced) {
          changed = selectResource(id, `selected-map:${map.id}`) || changed;
        }
      } else if (referenced.some((id) => resourceIds.has(id))) {
        changed = selectMap(
          map.id,
          `references-selected-resource:${referenced.filter((id) => resourceIds.has(id)).join(",")}`,
        ) || changed;
      }
    }
    for (const point of model.points) {
      for (const record of point.records) {
        const key = atlasPointRecordKey(point, record);
        const referenced = referencedResourceIds({
          targets: targetsForRecord(record),
          resourceIds: allResourceIds,
          resourceIdsByUri,
        });
        if (pointRecordKeys.has(key)) {
          for (const id of referenced) {
            changed = selectResource(
              id,
              `selected-point-record:${point.id}:${record.map}:${record.kind}`,
            ) || changed;
          }
        } else if (referenced.some((id) => resourceIds.has(id))) {
          changed = selectRecord(
            point,
            record,
            `references-selected-resource:${referenced.filter((id) => resourceIds.has(id)).join(",")}`,
          ) || changed;
        }
      }
    }
    for (const point of model.points) {
      if (!pointIds.has(point.id)) continue;
      const anchor = point.records.find(({ kind }) => kind === "anchor");
      if (anchor !== undefined) {
        changed = selectRecord(point, anchor, "selected-point-anchor-owner") || changed;
      }
    }
  }

  return Object.freeze({
    mapIds,
    pointIds,
    pointRecordKeys,
    resourceIds,
    mapReasons: freezeReasonMap(mapReasons),
    pointRecordReasons: freezeReasonMap(pointRecordReasons),
    resourceReasons: freezeReasonMap(resourceReasons),
  });
}

export function atlasPointRecordValue(point: FoundationAtlasPoint, record: FoundationAtlasPointRecord): unknown {
  return Object.freeze({
    id: point.id,
    title: point.title,
    summary: point.summary,
    kinds: point.kinds,
    posture: point.posture,
    lifecycle: point.lifecycle,
    primaryMap: point.primaryMap,
    anchorPath: point.anchorPath,
    record,
    relations: point.relations,
    incomingRelations: point.incomingRelations,
    review: point.review,
    extensions: point.extensions,
  });
}

/**
 * Governing semantics from the same selected normalized closure as Execution.
 * Atlas 0.8 root navigation/catalogues and Map membership/reverse-Map indexes
 * describe discovery. Authored root context and selected semantic units remain
 * governing; complete normalized units still travel in immutable Projection.
 */
export function atlasExecutionGoverningFacts(options: Readonly<{
  loaded: FoundationLoadedRepositoryEpoch;
  sourceRoots: readonly Pick<FoundationProjectionSourceRoot, "sourceId" | "authority">[];
}>): unknown {
  const model = options.loaded.atlas.model;
  const closure = planAtlasExecutionClosure(options);
  const root = model.atlas;
  return Object.freeze({
    root: { id: root.id, title: root.title, summary: root.summary, content: root.content,
      references: root.references, extensions: root.extensions, body: root.body },
    maps: model.maps.filter(({ id }) => closure.mapIds.has(id)).map((map) => ({
      id: map.id, title: map.title, summary: map.summary, question: map.question,
      status: map.status, path: map.path, areas: map.areas, content: map.content,
      references: map.references, extensions: map.extensions, body: map.body,
    })),
    points: model.points.flatMap((point) => point.records
      .filter((record) => closure.pointRecordKeys.has(atlasPointRecordKey(point, record)))
      .map((record) => atlasPointRecordValue(point, record))),
    resources: model.atlas.resources.filter(({ id }) => closure.resourceIds.has(id)).map((resource) => ({
      resource,
      binding: options.loaded.atlas.resolution.resourceBindings.find(({ resourceId }) => resourceId === resource.id) ?? null,
    })),
    // Unresolved selected identities are facts, never an empty successful closure.
    selectedSources: options.sourceRoots.filter(({ authority }) => authority === "atlas").map(({ sourceId }) => ({
      sourceId,
      resourceId: model.atlas.resources.find(({ id }) => atlasResourceSourceId(root.id, id) === sourceId)?.id ?? null,
    })),
  });
}
