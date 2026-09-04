import { posix } from "node:path";
import { FoundationError } from "../error.js";
import { objectBlobBytes } from "../repository/git.js";
import { pathWithin } from "../repository/product-state.js";
import type { FoundationGitTreeEntry, FoundationRepositoryContract } from "../repository/types.js";
import { sha256Bytes } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import type { DiagnosticCollector } from "../validation/result.js";
import type { FoundationKnowledgeRecord, FoundationKnowledgeSourceResolution, FoundationSourceBinding } from "./types.js";

const SOURCE_STAGE = "sources";

type RepositorySource = Readonly<{ path: string }>;
type SourceDisposition = FoundationKnowledgeSourceResolution["disposition"];

export type FoundationKnowledgeSourceValidation = Readonly<{
  resolutions: readonly FoundationKnowledgeSourceResolution[];
  complete: boolean;
  observedBytes: number;
  observedCount: number;
}>;

function repositorySource(recordPath: string, reference: string): RepositorySource | null {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(reference) || reference.startsWith("//") || reference.startsWith("/")) return null;
  const separator = reference.search(/[?#]/u);
  const pathReference = separator < 0 ? reference : reference.slice(0, separator);
  if (/%(?:2f|5c)/iu.test(pathReference)) {
    throw new FoundationError("lifecycle.path.invalid", `Repository source reference contains an encoded separator: ${reference}`);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathReference);
  } catch {
    throw new FoundationError("lifecycle.path.invalid", `Repository source reference contains invalid percent encoding: ${reference}`);
  }
  const resolved = decoded.length === 0
    ? recordPath
    : posix.normalize(posix.join(posix.dirname(recordPath), decoded));
  if (resolved.length === 0 || resolved === ".." || resolved.startsWith("../") || resolved.startsWith("/") || resolved.includes("\\")) {
    throw new FoundationError("lifecycle.path.invalid", `Repository source reference escapes the bound repository: ${reference}`);
  }
  return Object.freeze({ path: resolved });
}

function resolutionKey(value: FoundationKnowledgeSourceResolution): string {
  return `${value.recordId}\0${value.recordRevision.toString().padStart(10, "0")}\0${value.sourceId}\0${value.reference}`;
}

function resolution(options: {
  record: FoundationKnowledgeRecord;
  source: FoundationSourceBinding;
  kind: FoundationKnowledgeSourceResolution["kind"];
  locator: string | null;
  disposition: SourceDisposition;
  objectId?: string | null;
  resolvedDigest?: FoundationKnowledgeSourceResolution["resolvedDigest"];
}): FoundationKnowledgeSourceResolution {
  return Object.freeze({
    recordId: options.record.frontMatter.id,
    recordRevision: options.record.frontMatter.revision,
    sourceId: options.source.id,
    required: options.source.required,
    reference: options.source.reference,
    role: options.source.role,
    kind: options.kind,
    locator: options.locator,
    declaredRevision: options.source.revision,
    declaredDigest: options.source.digest,
    objectId: options.objectId ?? null,
    resolvedDigest: options.resolvedDigest ?? null,
    disposition: options.disposition,
  });
}

function unavailable(options: {
  collector: DiagnosticCollector;
  record: FoundationKnowledgeRecord;
  source: FoundationSourceBinding;
  disposition: Exclude<SourceDisposition, "resolved">;
  message: string;
  kind: FoundationKnowledgeSourceResolution["kind"];
  locator: string | null;
  related?: string[];
  facts?: Record<string, unknown>;
  objectId?: string | null;
  resolvedDigest?: FoundationKnowledgeSourceResolution["resolvedDigest"];
}): Readonly<{ value: FoundationKnowledgeSourceResolution; complete: boolean }> {
  const requiredCurrent = options.source.required && options.record.frontMatter.status === "current";
  options.collector.add({
    stage: SOURCE_STAGE,
    code: "lifecycle.knowledge.source-unresolved",
    severity: requiredCurrent ? "error" : "warning",
    message: options.message,
    path: options.record.path,
    related: options.related,
    facts: {
      declaredDigest: options.source.digest,
      declaredRevision: options.source.revision,
      disposition: options.disposition,
      recordStatus: options.record.frontMatter.status,
      reference: options.source.reference,
      required: options.source.required,
      role: options.source.role,
      sourceId: options.source.id,
      ...(options.facts ?? {}),
    },
  });
  return Object.freeze({
    value: resolution({
      record: options.record,
      source: options.source,
      kind: options.kind,
      locator: options.locator,
      disposition: options.disposition,
      objectId: options.objectId,
      resolvedDigest: options.resolvedDigest,
    }),
    complete: !requiredCurrent,
  });
}

function roleMatches(source: FoundationSourceBinding, kind: "repository" | "atlas"): boolean {
  if (source.role === "atlas-context") return kind === "atlas";
  if (source.role === "repository-reality") return kind === "repository";
  return true;
}

/** Resolve sources only from the exact bound tree; denied external retrieval is explicit. */
export async function validateKnowledgeSources(options: {
  repository: string;
  commit: string;
  contract: FoundationRepositoryContract;
  treeEntries: readonly FoundationGitTreeEntry[];
  records: readonly FoundationKnowledgeRecord[];
  collector: DiagnosticCollector;
}): Promise<FoundationKnowledgeSourceValidation> {
  const owners = new Set(options.contract.knowledge.owners);
  const tree = new Map(options.treeEntries.map((entry) => [entry.path, entry]));
  const resolutions: FoundationKnowledgeSourceResolution[] = [];
  const records = [...options.records].sort((left, right) => compareCodePoints(
    `${left.frontMatter.id}\0${left.frontMatter.revision.toString().padStart(10, "0")}`,
    `${right.frontMatter.id}\0${right.frontMatter.revision.toString().padStart(10, "0")}`,
  ));
  const declared = records.flatMap((record) => record.frontMatter.sources.map((source) => ({ record, source })));
  let complete = true;
  let observedBytes = 0;
  if (declared.length > options.contract.knowledge.limits.maximumSources) {
    complete = false;
    options.collector.add({
      stage: SOURCE_STAGE,
      code: "lifecycle.knowledge.limit-exceeded",
      message: `Knowledge declares ${declared.length} sources beyond the ${options.contract.knowledge.limits.maximumSources}-source bound`,
      facts: { maximumSources: options.contract.knowledge.limits.maximumSources, observedSources: declared.length },
    });
  }

  for (const record of records) {
    for (const owner of record.frontMatter.owners) {
      if (!owners.has(owner)) {
        options.collector.add({
          stage: "records",
          code: "lifecycle.knowledge.owner-missing",
          message: `${record.frontMatter.id} references unregistered owner ${owner}`,
          path: record.path,
          facts: { owner },
        });
      }
    }
  }

  const bounded = declared.slice(0, options.contract.knowledge.limits.maximumSources);
  const sourceIds = new Map<string, Set<string>>();
  const blobCache = new Map<string, Readonly<{ bytes: number; digest: FoundationKnowledgeSourceResolution["resolvedDigest"] }>>();
  for (const { record, source } of bounded) {
    const identityRevision = `${record.frontMatter.id}@${record.frontMatter.revision}`;
    const ids = sourceIds.get(identityRevision) ?? new Set<string>();
    if (ids.has(source.id)) {
      options.collector.add({
        stage: SOURCE_STAGE,
        code: "lifecycle.knowledge.source-duplicate",
        message: `${record.frontMatter.id} repeats source identity ${source.id}`,
        path: record.path,
        facts: { sourceId: source.id },
      });
    }
    ids.add(source.id);
    sourceIds.set(identityRevision, ids);

    let local: RepositorySource | null;
    try {
      local = repositorySource(record.path, source.reference);
    } catch (error) {
      const outcome = unavailable({
        collector: options.collector,
        record,
        source,
        disposition: "unreadable",
        message: error instanceof Error ? error.message : String(error),
        kind: "repository",
        locator: null,
      });
      resolutions.push(outcome.value);
      complete &&= outcome.complete;
      continue;
    }

    if (local === null) {
      const disposition: SourceDisposition = source.role === "repository-reality" || source.role === "atlas-context"
        ? "role-mismatch"
        : "retrieval-denied";
      const outcome = unavailable({
        collector: options.collector,
        record,
        source,
        disposition,
        message: disposition === "role-mismatch"
          ? `Source ${source.id} cannot claim ${source.role} through a denied external reference`
          : `External source ${source.id} is not retrieved by the exact-bound-tree Knowledge profile`,
        kind: "external",
        locator: null,
        facts: { retrievalPolicy: "denied" },
      });
      resolutions.push(outcome.value);
      complete &&= outcome.complete;
      continue;
    }

    const kind = pathWithin(local.path, options.contract.atlas.root) ? "atlas" : "repository";
    const entry = tree.get(local.path);
    if (entry === undefined) {
      const outcome = unavailable({
        collector: options.collector,
        record,
        source,
        disposition: "missing",
        message: `${record.frontMatter.id} source ${source.id} is missing from the exact bound tree`,
        kind,
        locator: local.path,
        related: [local.path],
      });
      resolutions.push(outcome.value);
      complete &&= outcome.complete;
      continue;
    }
    if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) {
      const outcome = unavailable({
        collector: options.collector,
        record,
        source,
        disposition: "unreadable",
        message: `${record.frontMatter.id} source ${source.id} is not one exact regular blob`,
        kind,
        locator: local.path,
        related: [local.path],
        facts: { mode: entry.mode, objectType: entry.type },
        objectId: entry.objectId,
      });
      resolutions.push(outcome.value);
      complete &&= outcome.complete;
      continue;
    }

    let blob = blobCache.get(entry.objectId);
    if (blob === undefined) {
      try {
        const bytes = await objectBlobBytes(options.repository, entry.objectId, options.contract.knowledge.limits.maximumSourceBytes);
        blob = Object.freeze({ bytes: bytes.byteLength, digest: sha256Bytes(bytes) });
        blobCache.set(entry.objectId, blob);
      } catch (error) {
        const outcome = unavailable({
          collector: options.collector,
          record,
          source,
          disposition: "unreadable",
          message: error instanceof Error ? error.message : String(error),
          kind,
          locator: local.path,
          related: [local.path],
          facts: { objectId: entry.objectId },
          objectId: entry.objectId,
        });
        resolutions.push(outcome.value);
        complete &&= outcome.complete;
        continue;
      }
    }
    if (observedBytes + blob.bytes > options.contract.knowledge.limits.maximumTotalSourceBytes) {
      complete = false;
      options.collector.add({
        stage: SOURCE_STAGE,
        code: "lifecycle.knowledge.limit-exceeded",
        message: `Knowledge source bytes exceed the ${options.contract.knowledge.limits.maximumTotalSourceBytes}-byte aggregate bound`,
        path: record.path,
        related: [local.path],
        facts: { maximumTotalSourceBytes: options.contract.knowledge.limits.maximumTotalSourceBytes, observedBefore: observedBytes, nextBytes: blob.bytes },
      });
      break;
    }
    observedBytes += blob.bytes;

    let disposition: SourceDisposition = "resolved";
    if (source.digest !== null && source.digest !== blob.digest) disposition = "digest-mismatch";
    else if (source.revision !== null && source.revision !== entry.objectId && source.revision !== options.commit) disposition = "revision-mismatch";
    else if (!roleMatches(source, kind)) disposition = "role-mismatch";
    if (disposition !== "resolved") {
      const outcome = unavailable({
        collector: options.collector,
        record,
        source,
        disposition,
        message: `${record.frontMatter.id} source ${source.id} does not match its exact ${disposition} declaration`,
        kind,
        locator: local.path,
        related: [local.path],
        facts: { actualCommit: options.commit, actualDigest: blob.digest, actualObjectId: entry.objectId },
        objectId: entry.objectId,
        resolvedDigest: blob.digest,
      });
      resolutions.push(outcome.value);
      complete &&= outcome.complete;
      continue;
    }
    resolutions.push(resolution({
      record,
      source,
      kind,
      locator: local.path,
      disposition,
      objectId: entry.objectId,
      resolvedDigest: blob.digest,
    }));
  }

  return Object.freeze({
    resolutions: Object.freeze(resolutions.sort((left, right) => compareCodePoints(resolutionKey(left), resolutionKey(right)))),
    complete,
    observedBytes,
    observedCount: declared.length,
  });
}

export function sourceResolutionIndex(
  resolutions: readonly FoundationKnowledgeSourceResolution[],
): ReadonlyMap<string, readonly FoundationKnowledgeSourceResolution[]> {
  const values = new Map<string, FoundationKnowledgeSourceResolution[]>();
  for (const value of resolutions) {
    const key = `${value.recordId}@${value.recordRevision}`;
    const entries = values.get(key) ?? [];
    entries.push(value);
    values.set(key, entries);
  }
  return new Map([...values].sort(([left], [right]) => compareCodePoints(left, right)).map(([key, entries]) => [
    key,
    Object.freeze(entries.sort((left, right) => compareCodePoints(resolutionKey(left), resolutionKey(right)))),
  ]));
}
