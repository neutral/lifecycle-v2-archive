import { FoundationError } from "../error.js";
import { expectedKnowledgeKind, parseKnowledgeSource, type FoundationKnowledgeSourceRecord } from "../knowledge/records.js";
import { normalizedKnowledgePath } from "../knowledge/structural.js";
import { buildRevisionIndexes, compareKnowledgeRecords } from "../knowledge/revisions.js";
import { FOUNDATION_REPOSITORY_CONTRACT_PATH, parseRepositoryContract } from "../repository/contract.js";
import { digestCanonical } from "../validation/canonical.js";
import { DiagnosticCollector } from "../validation/result.js";
import { compareCodePoints } from "../validation/ordering.js";
import { parseStrictJson } from "../validation/strict-json.js";
import { decodeFoundationLocalDraftUtf8, readFoundationLocalDraftFile } from "./local-reader.js";
import { FOUNDATION_LOCAL_DRAFT_LIMITS, FOUNDATION_LOCAL_DRAFT_PROFILE } from "./limits.js";

export async function inspectFoundationKnowledgeDraft(input: Readonly<{
  workspace: string;
  paths: readonly string[];
}>) {
  if (input.paths.length < 1 || input.paths.length > FOUNDATION_LOCAL_DRAFT_LIMITS.maximumKnowledgeFiles || new Set(input.paths).size !== input.paths.length) {
    throw new FoundationError("cli.usage", `draft knowledge requires 1 through ${FOUNDATION_LOCAL_DRAFT_LIMITS.maximumKnowledgeFiles} distinct explicit record paths; supply every local revision in each selected chain`);
  }
  const contractFile = await readFoundationLocalDraftFile({
    root: input.workspace, path: FOUNDATION_REPOSITORY_CONTRACT_PATH, maximumBytes: FOUNDATION_LOCAL_DRAFT_LIMITS.maximumContractBytes,
  });
  const contract = parseRepositoryContract(parseStrictJson(decodeFoundationLocalDraftUtf8(contractFile), {
    source: FOUNDATION_REPOSITORY_CONTRACT_PATH, maximumBytes: FOUNDATION_LOCAL_DRAFT_LIMITS.maximumContractBytes,
  }));
  const policy = Object.freeze({ knowledge: { roots: contract.knowledge.roots, limits: contract.knowledge.limits }, atlas: { root: contract.atlas.root } });
  const collector = new DiagnosticCollector();
  const records: FoundationKnowledgeSourceRecord[] = [];
  const observedFiles: { path: string; sourceDigest: string; byteLength: number }[] = [];
  const maximumBytes = Math.min(contract.knowledge.limits.maximumTotalRecordBytes, FOUNDATION_LOCAL_DRAFT_LIMITS.maximumKnowledgeTotalBytes);
  let totalBytes = 0;
  for (const path of [...input.paths].sort(compareCodePoints)) {
    normalizedKnowledgePath(path, "Local Knowledge path", contract.knowledge.limits.maximumPathBytes);
    if (expectedKnowledgeKind(path, policy) === null) {
      throw new FoundationError("lifecycle.knowledge.kind-location", "Select only Product Knowledge, Description, Check, or adopted Discipline record paths for local Knowledge inspection");
    }
    const file = await readFoundationLocalDraftFile({ root: input.workspace, path, maximumBytes: contract.knowledge.limits.maximumFileBytes });
    totalBytes += file.bytes.byteLength;
    if (totalBytes > maximumBytes || input.paths.length > contract.knowledge.limits.maximumRecords) {
      throw new FoundationError("lifecycle.draft.knowledge-bound", "Selected local Knowledge files exceed the reported record or aggregate byte bounds");
    }
    observedFiles.push({ path: file.path, sourceDigest: file.sourceDigest, byteLength: file.bytes.byteLength });
    try {
      records.push(parseKnowledgeSource({ path, bytes: file.bytes, contract: policy }));
    } catch (error) {
      if (!(error instanceof FoundationError)) throw error;
      collector.add({ stage: "records", code: error.code, message: error.message, path });
      for (const diagnostic of error.diagnostics) {
        collector.add("location" in diagnostic
          ? { stage: "records", code: diagnostic.code, message: diagnostic.message, path, pointer: diagnostic.location.jsonPointer, facts: diagnostic.facts }
          : { stage: "records", ...diagnostic, path });
      }
    }
  }
  records.sort(compareKnowledgeRecords);
  const parsedAll = records.length === input.paths.length;
  const lineage = parsedAll ? buildRevisionIndexes({ records, collector }) : null;
  return Object.freeze({
    kind: "knowledge-draft" as const,
    profile: FOUNDATION_LOCAL_DRAFT_PROFILE,
    authority: "advisory-local-observation" as const,
    status: collector.diagnostics.length === 0 ? "valid-for-checked-scope" as const : "needs-correction" as const,
    observedAt: new Date().toISOString(),
    sourceSelectionDigest: digestCanonical(observedFiles),
    parsingPolicyDigest: digestCanonical(policy),
    contractSourceDigest: contractFile.sourceDigest,
    observedFiles,
    limits: { maximumRecords: Math.min(FOUNDATION_LOCAL_DRAFT_LIMITS.maximumKnowledgeFiles, contract.knowledge.limits.maximumRecords), maximumFileBytes: contract.knowledge.limits.maximumFileBytes, maximumTotalRecordBytes: maximumBytes },
    checked: ["Selected local source syntax, schema, physical placement, body sections, and exact digests", ...(parsedAll ? ["Revision lineage among the explicit supplied files"] : [])],
    excluded: ["Unselected or missing workspace records, and an atomic workspace snapshot", "Repository-wide sources, relationships, coverage, Registry and Binding closure", "Admitted Snapshot, Candidate validity, currentness, operation eligibility and acceptance"],
    records: records.map((record) => ({
      path: record.path, id: record.frontMatter.id, kind: record.frontMatter.kind,
      revision: record.frontMatter.revision, status: record.frontMatter.status,
      sourceDigest: record.sourceDigest, semanticDigest: record.semanticDigest,
      supersedes: record.frontMatter.supersedes,
    })),
    localCurrent: lineage === null ? [] : lineage.currentRecords.map((record) => ({ id: record.frontMatter.id, revision: record.frontMatter.revision, path: record.path })),
    diagnostics: [...collector.diagnostics],
    next: collector.diagnostics.length === 0
      ? "Continue authoring within the admitted scope. Runtime independently validates the final collected result."
      : "Correct the named local records, supply each complete local chain, and rerun this read-only inspection. Promotion rewrites the prior local Current as Superseded and binds its recomputed digests; the admitted Snapshot keeps its original bytes.",
  });
}
