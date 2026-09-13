import { createHash } from "node:crypto";
import { FoundationError } from "../error.js";
import { FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS } from "../repository/contract.js";
import { assertExactAuthoritativePaths } from "../repository/product-state.js";
import { selfDigest, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { assertFoundationSchema, FOUNDATION_DISCIPLINE_PACK_SCHEMA_ID } from "../validation/schema-engine.js";
import { parseStrictJson } from "../validation/strict-json.js";
import { normalizedKnowledgePath } from "./structural.js";
import { parseKnowledgeRecord, type FoundationKnowledgeParsingPolicy } from "./records.js";

export type FoundationDisciplinePack = Readonly<{
  schema: "lifecycle.discipline-pack.v1";
  id: string;
  title: string;
  version: string;
  publisher: string;
  contract: Readonly<{ specificationRevision: string; knowledgeRecordSchema: "urn:lifecycle:schema:knowledge-record:v2" }>;
  records: readonly Readonly<{ id: string; path: string; revision: number; sourceDigest: Sha256; semanticDigest: Sha256 }>[];
  sets: readonly Readonly<{ id: string; title: string; description: string; recordIds: readonly string[] }>[];
  digest: Sha256;
}>;

const limits = FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS;
const parsingPolicy: FoundationKnowledgeParsingPolicy = Object.freeze({
  atlas: { root: "atlas" },
  knowledge: {
    limits,
    roots: { behavior: "records/behavior", assurance: "records/assurance", blueprint: "records/blueprint", check: "records/checks", discipline: "records/disciplines", disciplineRegistry: "records/disciplines/registry.json", descriptionPattern: "**/_*.desc.md" },
  },
});

function invalid(message: string): never {
  throw new FoundationError("lifecycle.discipline.pack-invalid", message);
}

function orderedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareCodePoints(values[index - 1]!, values[index]!) >= 0) invalid(`${label} must be unique and code-point ordered`);
  }
}

/** Validate the immutable envelope. Its authoring revision is provenance, never a parser selection. */
export function parseDisciplinePack(bytes: Buffer): FoundationDisciplinePack {
  if (bytes.byteLength > limits.maximumTotalRecordBytes) invalid("Pack manifest exceeds the bounded byte limit");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const value = parseStrictJson(text, { source: "Discipline Pack manifest", maximumBytes: limits.maximumTotalRecordBytes });
  assertFoundationSchema(FOUNDATION_DISCIPLINE_PACK_SCHEMA_ID, value, "pack.json");
  const pack = value as FoundationDisciplinePack;
  if (selfDigest(pack) !== pack.digest) invalid("Pack manifest self-digest does not reproduce");
  orderedUnique(pack.records.map(({ id }) => id), "Pack record identities");
  if (new Set(pack.sets.map(({ id }) => id)).size !== pack.sets.length) invalid("Pack Set identities must be unique");
  const paths = new Set<string>();
  const ids = new Set(pack.records.map(({ id }) => id));
  for (const record of pack.records) {
    const path = normalizedKnowledgePath(record.path, "Pack record path", limits.maximumPathBytes);
    if (!path.startsWith("records/") || !path.endsWith(".md") || path.split("/").some((part) => part === ".git")) invalid("Pack record path must identify Markdown content outside Git support");
    if (paths.has(path)) invalid("Pack inventory repeats a record path");
    paths.add(path);
  }
  assertExactAuthoritativePaths(pack.records);
  for (const set of pack.sets) {
    orderedUnique(set.recordIds, `Pack Set ${set.id} record identities`);
    if (set.recordIds.some((id) => !ids.has(id))) invalid(`Pack Set ${set.id} selects an uninventoried Discipline`);
  }
  return pack;
}

/** Check supplied inventory bytes against the current Knowledge parser; perform no retrieval or adoption. */
export function verifyDisciplinePackRecords(
  pack: FoundationDisciplinePack,
  entries: readonly Readonly<{ path: string; mode: string; bytes: Buffer }>[],
): FoundationDisciplinePack {
  if (entries.length !== pack.records.length || entries.length > limits.maximumRecords) invalid("Pack inventory and supplied record count differ");
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  if (byPath.size !== entries.length) invalid("Pack supplied record paths repeat");
  let aggregateBytes = 0;
  for (const selected of pack.records) {
    const entry = byPath.get(selected.path);
    if (entry === undefined) invalid("Pack is missing an inventoried record");
    aggregateBytes += entry.bytes.byteLength;
    if (aggregateBytes > limits.maximumTotalRecordBytes) invalid("Pack records exceed the aggregate byte limit");
    const objectId = createHash("sha1").update(`blob ${entry.bytes.byteLength}\0`).update(entry.bytes).digest("hex");
    const record = parseKnowledgeRecord({
      path: `records/disciplines/${selected.path}`,
      mode: entry.mode,
      objectId,
      bytes: entry.bytes,
      contract: parsingPolicy,
    });
    if (record.frontMatter.kind !== "discipline" || record.frontMatter.status !== "current" ||
        record.frontMatter.id !== selected.id || record.frontMatter.revision !== selected.revision ||
        record.sourceDigest !== selected.sourceDigest || record.semanticDigest !== selected.semanticDigest) {
      invalid(`Pack inventory does not reproduce exact current Discipline ${selected.id}`);
    }
    if (record.frontMatter.owners.length !== 1 || record.frontMatter.owners[0] !== pack.publisher) {
      invalid(`Pack Discipline ${selected.id} does not retain its sole publisher owner`);
    }
  }
  return pack;
}
