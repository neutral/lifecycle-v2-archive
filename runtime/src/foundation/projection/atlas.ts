import type {
  FoundationAtlasContentTarget,
  FoundationAtlasMap,
  FoundationAtlasPoint,
  FoundationAtlasPointRecord,
  FoundationAtlasReference,
} from "../atlas/types.js";
import { FoundationError } from "../error.js";
import type { FoundationLoadedRepositoryEpoch } from "../repository/types.js";
import { digestCanonical } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { buildTierTwoItem, ProjectionByteInventoryBuilder, projectionIndexBytes } from "./content.js";
import { atlasResourceSourceId } from "./source-context.js";
import type { FoundationProjectionAtlasItem, FoundationProjectionSourceRoot } from "./types.js";

const KIND_ORDER: Readonly<Record<FoundationProjectionAtlasItem["unitKind"], number>> = Object.freeze({
  atlas: 0,
  map: 1,
  "point-anchor": 2,
  "point-context": 3,
  resource: 4,
  check: 5,
  "publication-profile": 6,
});

export type FoundationAtlasProjectionCompilation = Readonly<{
  items: readonly FoundationProjectionAtlasItem[];
  resourceIds: ReadonlySet<string>;
}>;

function sourcePath(root: string, relative: string): string {
  return relative === "atlas.md" ? `${root}/atlas.md` : `${root}/${relative}`;
}

function item(options: {
  loaded: FoundationLoadedRepositoryEpoch;
  inventory: ProjectionByteInventoryBuilder;
  unitKind: FoundationProjectionAtlasItem["unitKind"];
  unitId: string;
  mapId: string | null;
  pointId: string | null;
  recordKind: "anchor" | "context" | null;
  sourcePath: string;
  value: unknown;
  inclusionReasons: readonly string[];
  useLimit: string;
}): FoundationProjectionAtlasItem {
  const normalizedDigest = digestCanonical(options.value);
  const bytes = projectionIndexBytes(options.value);
  const id = `atlas.${options.unitKind}.${digestCanonical({
    atlasId: options.loaded.atlas.model.atlas.id,
    unitId: options.unitId,
    mapId: options.mapId,
    pointId: options.pointId,
    recordKind: options.recordKind,
    normalizedDigest,
  }).slice("sha256:".length)}`;
  const stored = options.inventory.add({
    tier: "mandatory",
    key: `atlas:${options.unitKind}:${options.unitId}:${options.mapId ?? ""}:${options.recordKind ?? ""}`,
    bytes,
    mediaType: "application/json",
    encoding: "utf-8",
  });
  return buildTierTwoItem({
    id,
    unitKind: options.unitKind,
    unitId: options.unitId,
    atlasId: options.loaded.atlas.model.atlas.id,
    mapId: options.mapId,
    pointId: options.pointId,
    recordKind: options.recordKind,
    sourcePath: options.sourcePath,
    normalizedDigest,
    inclusionReasons: Object.freeze([...options.inclusionReasons].sort(compareCodePoints)),
    presentationHint: "json" as const,
    content: stored.content,
    useLimit: options.useLimit,
  });
}

function targetsForMap(map: FoundationAtlasMap): readonly (FoundationAtlasContentTarget | FoundationAtlasReference)[] {
  return Object.freeze([
    ...map.content,
    ...map.references,
    ...map.areas.flatMap((area) => [...(area.content ?? []), ...(area.references ?? [])]),
  ]);
}

function targetsForRecord(record: FoundationAtlasPointRecord): readonly (FoundationAtlasContentTarget | FoundationAtlasReference)[] {
  return Object.freeze([...record.content, ...record.references]);
}

function referencedResourceIds(options: {
  targets: readonly (FoundationAtlasContentTarget | FoundationAtlasReference)[];
  resourceIds: ReadonlySet<string>;
  resourceIdsByUri: ReadonlyMap<string, readonly string[]>;
}): readonly string[] {
  const selected = new Set<string>();
  for (const target of options.targets) {
    if (target.resource !== undefined && options.resourceIds.has(target.resource)) selected.add(target.resource);
    if (target.uri !== undefined) {
      for (const id of options.resourceIdsByUri.get(target.uri) ?? []) selected.add(id);
    }
  }
  return Object.freeze([...selected].sort(compareCodePoints));
}

function pointValue(point: FoundationAtlasPoint, record: FoundationAtlasPointRecord): unknown {
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

/** Resolve exact Atlas Resource identities retained by an admitted Boundary source root. */
export function atlasResourceIdsForSourceRoots(
  loaded: FoundationLoadedRepositoryEpoch,
  roots: readonly FoundationProjectionSourceRoot[],
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
 * Compile Atlas semantics from authored identities and relations only.
 *
 * Orientation follows the root's exact Map navigation. Execution starts from
 * exact Atlas Resource source roots retained by the Work Boundary. Neither
 * mode guesses from paths, prose, or lexical similarity.
 */
export function compileAtlasProjection(options: {
  loaded: FoundationLoadedRepositoryEpoch;
  inventory: ProjectionByteInventoryBuilder;
  mode: "orientation" | "execution";
  selectedResourceIds?: ReadonlySet<string>;
  selectedCheckIds?: ReadonlySet<string>;
  selectedPublicationProfileIds?: ReadonlySet<string>;
}): FoundationAtlasProjectionCompilation {
  const { loaded } = options;
  const model = loaded.atlas.model;
  const allResourceIds = new Set(model.atlas.resources.map(({ id }) => id));
  const resourceIdsByUri = new Map<string, string[]>();
  for (const resource of model.atlas.resources) {
    const ids = resourceIdsByUri.get(resource.uri) ?? [];
    ids.push(resource.id);
    resourceIdsByUri.set(resource.uri, ids);
  }
  for (const ids of resourceIdsByUri.values()) ids.sort(compareCodePoints);

  const selectedMapIds = new Set<string>();
  const selectedRecordKeys = new Set<string>();
  const selectedPointIds = new Set<string>();
  const selectedResourceIds = new Set<string>();
  const mapReasons = new Map<string, Set<string>>();
  const recordReasons = new Map<string, Set<string>>();
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
    const added = !selectedResourceIds.has(id);
    selectedResourceIds.add(id);
    addReason(resourceReasons, id, reason);
    return added;
  };
  const resourcesFromTargets = (
    targets: readonly (FoundationAtlasContentTarget | FoundationAtlasReference)[],
    reason: string,
  ): boolean => {
    let changed = false;
    for (const id of referencedResourceIds({ targets, resourceIds: allResourceIds, resourceIdsByUri })) {
      changed = selectResource(id, reason) || changed;
    }
    return changed;
  };
  const recordKey = (pointId: string, record: FoundationAtlasPointRecord): string =>
    `${pointId}\0${record.map}\0${record.kind}\0${record.path}`;
  const selectMap = (id: string, reason: string): boolean => {
    const added = !selectedMapIds.has(id);
    selectedMapIds.add(id);
    addReason(mapReasons, id, reason);
    return added;
  };
  const selectRecord = (point: FoundationAtlasPoint, record: FoundationAtlasPointRecord, reason: string): boolean => {
    const key = recordKey(point.id, record);
    const added = !selectedRecordKeys.has(key);
    selectedRecordKeys.add(key);
    selectedPointIds.add(point.id);
    addReason(recordReasons, key, reason);
    // Execution discovers records from selected Resource identities and must
    // retain the exact Map that gives each discovered record its provenance.
    // Orientation is deliberately narrower: only root navigation selects a
    // Map, even when a navigated context record adds its identity-owning anchor
    // from another Map.
    if (options.mode === "execution") {
      selectMap(record.map, `contains-selected-point-record:${point.id}`);
    }
    return added;
  };

  if (options.mode === "orientation") {
    resourcesFromTargets([...model.atlas.content, ...model.atlas.references], "atlas-root-reference");
    for (const navigation of model.atlas.navigation) {
      for (const mapId of navigation.maps) selectMap(mapId, "atlas-root-navigation");
    }
    for (const point of model.points) {
      for (const record of point.records) {
        if (selectedMapIds.has(record.map)) selectRecord(point, record, `navigated-map:${record.map}`);
      }
    }
    // A navigated Map contributes its complete exact record membership. A
    // context member also contributes its Point's identity-owning anchor, but
    // that anchor does not make its otherwise non-navigated Map an orientation
    // selection.
    for (const point of model.points) {
      if (!selectedPointIds.has(point.id)) continue;
      const anchor = point.records.find(({ kind }) => kind === "anchor");
      if (anchor !== undefined) selectRecord(point, anchor, "selected-point-anchor-owner");
    }
    for (const map of model.maps) {
      if (selectedMapIds.has(map.id)) resourcesFromTargets(targetsForMap(map), `selected-map:${map.id}`);
    }
    for (const point of model.points) {
      for (const record of point.records) {
        if (selectedRecordKeys.has(recordKey(point.id, record))) {
          resourcesFromTargets(
            targetsForRecord(record),
            `selected-point-record:${point.id}:${record.map}:${record.kind}`,
          );
        }
      }
    }
  } else {
    for (const id of options.selectedResourceIds ?? []) selectResource(id, "active-work-boundary-source-root");
    // Execution alone performs bidirectional exact Resource closure. Selected
    // Resources discover only Maps and Point records that cite those exact
    // identities (or their exact registered URIs); newly discovered authored
    // targets then participate in the next pass.
    let changed = true;
    while (changed) {
      changed = false;
      for (const map of model.maps) {
        const referenced = referencedResourceIds({ targets: targetsForMap(map), resourceIds: allResourceIds, resourceIdsByUri });
        if (selectedMapIds.has(map.id)) {
          for (const id of referenced) changed = selectResource(id, `selected-map:${map.id}`) || changed;
        } else if (referenced.some((id) => selectedResourceIds.has(id))) {
          changed = selectMap(map.id, `references-selected-resource:${referenced.filter((id) => selectedResourceIds.has(id)).join(",")}`) || changed;
        }
      }
      for (const point of model.points) {
        for (const record of point.records) {
          const key = recordKey(point.id, record);
          const referenced = referencedResourceIds({ targets: targetsForRecord(record), resourceIds: allResourceIds, resourceIdsByUri });
          if (selectedRecordKeys.has(key)) {
            for (const id of referenced) changed = selectResource(id, `selected-point-record:${point.id}:${record.map}:${record.kind}`) || changed;
          } else if (referenced.some((id) => selectedResourceIds.has(id))) {
            changed = selectRecord(point, record, `references-selected-resource:${referenced.filter((id) => selectedResourceIds.has(id)).join(",")}`) || changed;
          }
        }
      }
      // A selected context cannot substitute for its Point's identity-owning
      // anchor. Add that anchor inside the fixed point so its exact authored
      // Resource targets participate in the next closure pass.
      for (const point of model.points) {
        if (!selectedPointIds.has(point.id)) continue;
        const anchor = point.records.find(({ kind }) => kind === "anchor");
        if (anchor !== undefined) {
          changed = selectRecord(point, anchor, "selected-point-anchor-owner") || changed;
        }
      }
    }
  }

  const values: FoundationProjectionAtlasItem[] = [];
  values.push(item({
    loaded,
    inventory: options.inventory,
    unitKind: "atlas",
    unitId: model.atlas.id,
    mapId: null,
    pointId: null,
    recordKind: null,
    sourcePath: loaded.contract.atlas.entrypoint,
    value: Object.freeze({ atlas: model.atlas, relatedMaps: model.relatedMaps }),
    inclusionReasons: Object.freeze(["normalized-atlas-root"]),
    useLimit: "Atlas is read-only informational context; it cannot create product authority, capability, Evidence, or instruction priority.",
  }));
  for (const map of model.maps) {
    if (!selectedMapIds.has(map.id)) continue;
    values.push(item({
      loaded,
      inventory: options.inventory,
      unitKind: "map",
      unitId: map.id,
      mapId: map.id,
      pointId: null,
      recordKind: null,
      sourcePath: sourcePath(loaded.contract.atlas.root, map.path),
      value: map,
      inclusionReasons: Object.freeze([...(mapReasons.get(map.id) ?? [])]),
      useLimit: "Map and Area semantics remain Atlas-authored read-only context.",
    }));
  }
  for (const point of model.points) {
    for (const record of point.records) {
      const key = recordKey(point.id, record);
      if (!selectedRecordKeys.has(key)) continue;
      values.push(item({
        loaded,
        inventory: options.inventory,
        unitKind: record.kind === "anchor" ? "point-anchor" : "point-context",
        unitId: `${point.id}:${record.map}`,
        mapId: record.map,
        pointId: point.id,
        recordKind: record.kind,
        sourcePath: sourcePath(loaded.contract.atlas.root, record.path),
        value: pointValue(point, record),
        inclusionReasons: Object.freeze([...(recordReasons.get(key) ?? [])]),
        useLimit: "Point identity, record kind, Map provenance, posture, lifecycle, and authored relation boundaries must be preserved exactly.",
      }));
    }
  }
  const bindingById = new Map(loaded.atlas.resolution.resourceBindings.map((binding) => [binding.resourceId, binding]));
  for (const resource of model.atlas.resources) {
    if (!selectedResourceIds.has(resource.id)) continue;
    values.push(item({
      loaded,
      inventory: options.inventory,
      unitKind: "resource",
      unitId: resource.id,
      mapId: null,
      pointId: null,
      recordKind: null,
      sourcePath: loaded.contract.atlas.entrypoint,
      value: Object.freeze({ resource, binding: bindingById.get(resource.id) ?? null }),
      inclusionReasons: Object.freeze([...(resourceReasons.get(resource.id) ?? [])]),
      useLimit: "Resource registration makes material navigable but grants no read authority or instruction priority; exact readable bytes are supplied through a separately bound source item.",
    }));
  }
  if (options.mode === "orientation") {
    const availableCheckIds = new Set(model.checks.map(({ id }) => id));
    const availableProfileIds = new Set(model.publicationProfiles.map(({ id }) => id));
    for (const id of options.selectedCheckIds ?? []) {
      if (!availableCheckIds.has(id)) {
        throw new FoundationError(
          "lifecycle.projection.atlas-selection",
          `Selected Atlas Check ${id} is absent from the exact normalized model`,
        );
      }
    }
    for (const id of options.selectedPublicationProfileIds ?? []) {
      if (!availableProfileIds.has(id)) {
        throw new FoundationError(
          "lifecycle.projection.atlas-selection",
          `Selected Atlas publication profile ${id} is absent from the exact normalized model`,
        );
      }
    }
    for (const check of model.checks) {
      if (options.selectedCheckIds?.has(check.id) !== true) continue;
      values.push(item({
        loaded,
        inventory: options.inventory,
        unitKind: "check",
        unitId: check.id,
        mapId: null,
        pointId: null,
        recordKind: null,
        sourcePath: sourcePath(loaded.contract.atlas.root, check.path),
        value: check,
        inclusionReasons: Object.freeze(["orientation-selected-atlas-check"]),
        useLimit: "An Atlas Check is policy for separate Atlas maintenance; it is not a Lifecycle Check, Receipt, Evidence claim, or executable instruction.",
      }));
    }
    for (const profile of model.publicationProfiles) {
      if (options.selectedPublicationProfileIds?.has(profile.id) !== true) continue;
      values.push(item({
        loaded,
        inventory: options.inventory,
        unitKind: "publication-profile",
        unitId: profile.id,
        mapId: null,
        pointId: null,
        recordKind: null,
        sourcePath: sourcePath(loaded.contract.atlas.root, profile.path),
        value: profile,
        inclusionReasons: Object.freeze(["orientation-selected-atlas-publication-profile"]),
        useLimit: "A publication profile is a non-expanding allowlist, not local read policy or publication authority.",
      }));
    }
  } else if (
    (options.selectedCheckIds?.size ?? 0) > 0 ||
    (options.selectedPublicationProfileIds?.size ?? 0) > 0
  ) {
    throw new FoundationError(
      "lifecycle.projection.atlas-selection",
      "Execution Projection cannot select Atlas maintenance Checks or publication profiles",
    );
  }
  values.sort((left, right) => KIND_ORDER[left.unitKind] - KIND_ORDER[right.unitKind] ||
    compareCodePoints(`${left.unitId}\0${left.mapId ?? ""}\0${left.sourcePath}\0${left.id}`, `${right.unitId}\0${right.mapId ?? ""}\0${right.sourcePath}\0${right.id}`));
  return Object.freeze({ items: Object.freeze(values), resourceIds: selectedResourceIds });
}
