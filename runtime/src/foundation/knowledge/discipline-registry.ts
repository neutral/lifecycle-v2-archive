import { FoundationError } from "../error.js";
import { FOUNDATION_DISCIPLINE_REGISTRY_SCHEMA } from "../constants.js";
import type { FoundationRepositoryContract } from "../repository/types.js";
import { selfDigest } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import {
  FOUNDATION_DISCIPLINE_REGISTRY_SCHEMA_ID,
  assertFoundationSchema,
} from "../validation/schema-engine.js";
import { parseStrictJson } from "../validation/strict-json.js";
import {
  array,
  enumeration,
  exactKeys,
  integer,
  knowledgeId,
  normalizedPath,
  object,
  opaqueId,
  ownerId,
  sha256,
  singleLine,
  text,
  uniqueStrings,
} from "../validation/value.js";
import type {
  FoundationDisciplineAdoption,
  FoundationDisciplinePackRegistration,
  FoundationDisciplineRegistry,
  FoundationDisciplineWorkType,
  FoundationKnowledgeRecord,
} from "./types.js";

export const FOUNDATION_DISCIPLINE_REGISTRY_PATH = "records/disciplines/registry.json" as const;

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function duplicateIdentity(values: readonly { id: string }[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]!.id === values[index]!.id) {
      throw new FoundationError("lifecycle.discipline.registry-duplicate", `${label} repeats identity ${values[index]!.id}`);
    }
  }
}

function uriReference(value: unknown, label: string): string {
  const result = text(value, label, 8192);
  if (/\s|[\u0000-\u001f\u007f]/u.test(result)) {
    throw new FoundationError("lifecycle.discipline.registry-source", `${label} must be one URI reference without whitespace or control characters`);
  }
  try {
    new URL(result, "https://lifecycle.invalid/");
  } catch {
    throw new FoundationError("lifecycle.discipline.registry-source", `${label} is not a valid URI reference`);
  }
  return result;
}

function pack(value: unknown, index: number): FoundationDisciplinePackRegistration {
  const label = `Discipline registry pack ${index}`;
  const source = object(value, "lifecycle.discipline.registry-pack", label);
  exactKeys(source, ["id", "publisher", "version", "source", "revision", "manifestDigest"], [], "lifecycle.discipline.registry-pack", label);
  return Object.freeze({
    id: opaqueId(source.id, `${label} identity`),
    publisher: ownerId(source.publisher, `${label} publisher`),
    version: opaqueId(source.version, `${label} version`),
    source: uriReference(source.source, `${label} source`),
    revision: opaqueId(source.revision, `${label} revision`),
    manifestDigest: sha256(source.manifestDigest, `${label} manifest digest`),
  });
}

function adoption(
  value: unknown,
  index: number,
  contract: FoundationRepositoryContract,
): FoundationDisciplineAdoption {
  const label = `Discipline registry adoption ${index}`;
  const source = object(value, "lifecycle.discipline.registry-adoption", label);
  exactKeys(
    source,
    ["id", "revision", "path", "sourceDigest", "semanticDigest", "packId"],
    [],
    "lifecycle.discipline.registry-adoption",
    label,
  );
  const id = knowledgeId(source.id, `${label} identity`);
  if (!id.startsWith("discipline.")) {
    throw new FoundationError("lifecycle.discipline.registry-adoption", `${label} must identify one Discipline record`);
  }
  const path = normalizedPath(source.path, `${label} path`);
  if (!path.startsWith(`${contract.knowledge.roots.discipline}/`) || !path.endsWith(".md")) {
    throw new FoundationError("lifecycle.discipline.registry-adoption", `${label} path must locate one adopted Discipline record`);
  }
  return Object.freeze({
    id,
    revision: integer(source.revision, `${label} revision`, 1),
    path,
    sourceDigest: sha256(source.sourceDigest, `${label} source digest`),
    semanticDigest: sha256(source.semanticDigest, `${label} semantic digest`),
    packId: opaqueId(source.packId, `${label} pack identity`),
  });
}

function workType(value: unknown, index: number): FoundationDisciplineWorkType {
  const label = `Discipline registry work type ${index}`;
  const source = object(value, "lifecycle.discipline.registry-work-type", label);
  exactKeys(source, ["id", "title", "description", "disciplineIds"], [], "lifecycle.discipline.registry-work-type", label);
  const disciplineIds = uniqueStrings(source.disciplineIds, `${label} Discipline identities`, 1, 4096, 160)
    .map((entry, disciplineIndex) => {
      const id = knowledgeId(entry, `${label} Discipline identity ${disciplineIndex}`);
      if (!id.startsWith("discipline.")) {
        throw new FoundationError("lifecycle.discipline.registry-work-type", `${label} references non-Discipline Knowledge ${id}`);
      }
      return id;
    })
    .sort(compareCodePoints);
  return Object.freeze({
    id: opaqueId(source.id, `${label} identity`),
    title: singleLine(source.title, `${label} title`, 1024),
    description: text(source.description, `${label} description`),
    disciplineIds: Object.freeze(disciplineIds),
  });
}

export function createEmptyDisciplineRegistry(): FoundationDisciplineRegistry {
  const subject = Object.freeze({
    schema: FOUNDATION_DISCIPLINE_REGISTRY_SCHEMA,
    packs: Object.freeze([]),
    adoptions: Object.freeze([]),
    workTypes: Object.freeze([]),
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

export function parseDisciplineRegistry(
  bytes: Uint8Array,
  contract: FoundationRepositoryContract,
): FoundationDisciplineRegistry {
  let sourceText: string;
  try {
    sourceText = STRICT_UTF8.decode(bytes);
  } catch {
    throw new FoundationError("lifecycle.discipline.registry-encoding", "Discipline registry must be valid UTF-8 JSON");
  }
  const value = parseStrictJson(sourceText, {
    source: contract.knowledge.roots.disciplineRegistry,
    maximumBytes: contract.knowledge.limits.maximumFileBytes,
    maximumDepth: contract.knowledge.limits.maximumJsonDepth,
    maximumNodes: contract.knowledge.limits.maximumJsonNodes,
    maximumObjectProperties: contract.knowledge.limits.maximumObjectProperties,
    maximumArrayItems: contract.knowledge.limits.maximumArrayItems,
  });
  assertFoundationSchema(FOUNDATION_DISCIPLINE_REGISTRY_SCHEMA_ID, value, contract.knowledge.roots.disciplineRegistry);
  const source = object(value, "lifecycle.discipline.registry", "Discipline registry");
  exactKeys(source, ["schema", "packs", "adoptions", "workTypes", "digest"], [], "lifecycle.discipline.registry", "Discipline registry");
  const packs = array(source.packs, "Discipline registry packs", 0, 4096).map(pack)
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const adoptions = array(source.adoptions, "Discipline registry adoptions", 0, 65_536)
    .map((entry, index) => adoption(entry, index, contract))
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const workTypes = array(source.workTypes, "Discipline registry work types", 0, 4096).map(workType)
    .sort((left, right) => compareCodePoints(left.id, right.id));
  duplicateIdentity(packs, "Discipline registry packs");
  duplicateIdentity(adoptions, "Discipline registry adoptions");
  duplicateIdentity(workTypes, "Discipline registry work types");
  const packIds = new Set(packs.map(({ id }) => id));
  for (const entry of adoptions) {
    if (!packIds.has(entry.packId)) {
      throw new FoundationError(
        "lifecycle.discipline.registry-pack-missing",
        `Adopted Discipline ${entry.id} cites unregistered pack ${entry.packId}`,
      );
    }
  }
  const adoptedIds = new Set(adoptions.map(({ id }) => id));
  for (const entry of workTypes) {
    for (const id of entry.disciplineIds) {
      if (!adoptedIds.has(id)) {
        throw new FoundationError(
          "lifecycle.discipline.registry-adoption-missing",
          `Work type ${entry.id} cites unadopted Discipline ${id}`,
        );
      }
    }
  }
  const parsed: FoundationDisciplineRegistry = Object.freeze({
    schema: enumeration(source.schema, "Discipline registry schema", [FOUNDATION_DISCIPLINE_REGISTRY_SCHEMA] as const),
    packs: Object.freeze(packs),
    adoptions: Object.freeze(adoptions),
    workTypes: Object.freeze(workTypes),
    digest: sha256(source.digest, "Discipline registry digest"),
  });
  if (selfDigest(parsed) !== parsed.digest) {
    throw new FoundationError("lifecycle.discipline.registry-digest", "Discipline registry digest does not bind its exact canonical subject");
  }
  return parsed;
}

export function validateDisciplineRegistryRecords(
  registry: FoundationDisciplineRegistry,
  currentRecords: readonly FoundationKnowledgeRecord[],
): void {
  const disciplines = currentRecords.filter(({ frontMatter }) => frontMatter.kind === "discipline");
  const byId = new Map(disciplines.map((record) => [record.frontMatter.id, record]));
  if (byId.size !== disciplines.length || registry.adoptions.length !== disciplines.length) {
    throw new FoundationError(
      "lifecycle.discipline.registry-coverage",
      "Discipline registry adoptions must exactly cover all current adopted Discipline records",
      { observedFacts: { adoptions: registry.adoptions.length, currentDisciplines: disciplines.length } },
    );
  }
  for (const adoption of registry.adoptions) {
    const record = byId.get(adoption.id);
    if (
      record === undefined ||
      record.frontMatter.revision !== adoption.revision ||
      record.path !== adoption.path ||
      record.sourceDigest !== adoption.sourceDigest ||
      record.semanticDigest !== adoption.semanticDigest
    ) {
      throw new FoundationError(
        "lifecycle.discipline.registry-adoption-mismatch",
        `Discipline registry adoption ${adoption.id} does not bind the exact current record`,
      );
    }
  }
}
