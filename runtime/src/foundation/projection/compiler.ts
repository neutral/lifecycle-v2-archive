import { asLifecycleError } from "../../errors.js";
import { FOUNDATION_PROJECTION_SCHEMA } from "../constants.js";
import type { ControlRecordRevision } from "../control/types.js";
import { FoundationError } from "../error.js";
import type { FoundationKnowledgeSet, FoundationKnowledgeSetResult } from "../knowledge/types.js";
import type { FoundationLoadedRepositoryEpoch, FoundationLoadedRepositorySnapshot } from "../repository/types.js";
import { canonicalJson, selfDigest, sha256Bytes } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { DiagnosticCollector, foundationValidationImplementation, type FoundationValidationResult } from "../validation/result.js";
import { ProjectionByteInventoryBuilder } from "./content.js";
import type { FoundationBuilderRepairRepositoryV1 } from "../candidate/repair-output.js";
import {
  compileExecution,
  type FoundationAgentWorkProductProjectionEvidence,
  type FoundationReviewerProjectionObservation,
  type FoundationIntegrationParentProjectionInput,
  type FoundationIntegrationProjectionRecords,
  type FoundationFailedIntegrationProjectionInput,
} from "./execution.js";
import { compileOrientation, FOUNDATION_PROJECTION_COMPILER_IDENTITY } from "./orientation.js";
import {
  assertExecutionProjectionRequestBasis,
  assertExecutionProjectionSubject,
  assertOrientationProjectionRequestBasis,
  parseProjectionRequest,
  projectionBasis,
} from "./request.js";
import type {
  FoundationCompiledProjection,
  FoundationExecutionProjectionRequest,
  FoundationExecutionProjectionSubject,
  FoundationKnowledgeProjection,
  FoundationOrientationProjectionRequest,
  FoundationProjectionCountPair,
  FoundationProjectionRequest,
  FoundationProjectionResult,
} from "./types.js";
import { projectionCacheKey, verifyCompiledProjection } from "./verification.js";
import { compileAtlasProjection } from "./atlas.js";

import { bindFoundationMandatoryProjectionRefusalV1, completeMandatoryProjectionSizeErrorV1, retainFoundationMandatoryProjectionRefusalV1, type FoundationMandatoryProjectionRefusalV1 } from "./mandatory-refusal.js";
export { foundationMandatoryProjectionRefusalV1 } from "./mandatory-refusal.js";
export type { FoundationMandatoryProjectionRefusalV1 } from "./mandatory-refusal.js";

const STAGES = ["request", "basis", "closure", "content", "bounds", "digest"] as const;
const KNOWLEDGE_KIND_ORDER = new Map([
  ["behavior", 0],
  ["assurance", 1],
  ["blueprint", 2],
  ["description", 3],
  ["check", 4],
  ["discipline", 5],
]);
const MAXIMUM_DIAGNOSTIC_FACT_DEPTH = 8;
const MAXIMUM_DIAGNOSTIC_FACT_VALUES = 256;
const MAXIMUM_DIAGNOSTIC_FACT_STRING_BYTES = 16 * 1024;
const CAPTURED_TEXT_FACT_KEYS = new Set(["stderr", "stdout"]);

type DiagnosticFactBudget = { values: number };

function byteFact(value: string | Uint8Array): Readonly<{ byteLength: number; digest: `sha256:${string}` }> {
  const byteLength = typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
  return Object.freeze({ byteLength, digest: sha256Bytes(value) });
}

function diagnosticFactValue(
  value: unknown,
  key: string | null,
  depth: number,
  budget: DiagnosticFactBudget,
  ancestors: Set<object>,
): unknown {
  if (budget.values >= MAXIMUM_DIAGNOSTIC_FACT_VALUES) return "fact-value-limit";
  budget.values += 1;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    return CAPTURED_TEXT_FACT_KEYS.has(key ?? "") || bytes > MAXIMUM_DIAGNOSTIC_FACT_STRING_BYTES
      ? byteFact(value)
      : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
      ? (Object.is(value, -0) ? 0 : value)
      : "non-canonical-number";
  }
  if (value instanceof Uint8Array) return byteFact(value);
  if (depth >= MAXIMUM_DIAGNOSTIC_FACT_DEPTH) return "fact-depth-limit";
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return "cyclic-fact";
    ancestors.add(value);
    const result: unknown[] = [];
    for (const item of value) {
      if (budget.values >= MAXIMUM_DIAGNOSTIC_FACT_VALUES) {
        result.push("fact-value-limit");
        break;
      }
      result.push(diagnosticFactValue(item, null, depth + 1, budget, ancestors));
    }
    ancestors.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) return "cyclic-fact";
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return "non-canonical-object";
    ancestors.add(value);
    const result: Record<string, unknown> = {};
    for (const childKey of Object.keys(value as Record<string, unknown>).sort()) {
      if (budget.values >= MAXIMUM_DIAGNOSTIC_FACT_VALUES) {
        result.factValueLimitReached = true;
        break;
      }
      const child = (value as Record<string, unknown>)[childKey];
      if (child !== undefined) result[childKey] = diagnosticFactValue(child, childKey, depth + 1, budget, ancestors);
    }
    ancestors.delete(value);
    return result;
  }
  return `non-canonical-${typeof value}`;
}

function diagnosticFacts(value: unknown, originalCode: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { originalCode };
  try {
    const sanitized = diagnosticFactValue(value, null, 0, { values: 0 }, new Set());
    if (sanitized === null || typeof sanitized !== "object" || Array.isArray(sanitized)) return { originalCode };
    const facts = sanitized as Record<string, unknown>;
    canonicalJson(facts);
    return facts;
  } catch {
    return { originalCode };
  }
}

function revisionSortKey(revision: string | number | null): string {
  if (revision === null) return "0:";
  return typeof revision === "number" ? `1:${revision.toString().padStart(16, "0")}` : `2:${revision}`;
}

export type FoundationOrientationCompilerInput = Readonly<{
  request: unknown;
  repository: FoundationLoadedRepositoryEpoch;
  knowledge: FoundationKnowledgeSetResult;
  observedAt?: string;
}>;

export type FoundationExecutionCompilerInput = Readonly<{
  request: unknown;
  repository: FoundationLoadedRepositorySnapshot;
  repositoryValidation: FoundationValidationResult;
  knowledge: FoundationKnowledgeSet;
  subject: FoundationExecutionProjectionSubject;
  /** Exact retained Work Boundary revision selected by the request. */
  workBoundary: ControlRecordRevision;
  candidateObservation?: FoundationReviewerProjectionObservation | null;
  integrationParent?: FoundationIntegrationParentProjectionInput | null;
  integrationRecords?: FoundationIntegrationProjectionRecords | null;
  failedIntegration?: FoundationFailedIntegrationProjectionInput | null;
  builderRepair?: FoundationBuilderRepairRepositoryV1 | null;
  /** Runtime-private, callback-scoped Git repository for verified Candidate Carrier objects. */
  candidateObjectRepository?: string | null;
  /** Exact current Check Receipt revisions selected for fresh review. */
  checkReceipts?: readonly ControlRecordRevision[];
  /** Exact applicable Agent Work Products and their retained Attempt subjects. */
  agentWorkProducts?: readonly FoundationAgentWorkProductProjectionEvidence[];
  observedAt?: string;
}>;

export type FoundationProjectionCompilerInput = FoundationOrientationCompilerInput | FoundationExecutionCompilerInput;

function bytesOf(items: readonly { content: { byteLength: number } }[]): FoundationProjectionCountPair {
  return Object.freeze({ items: items.length, bytes: items.reduce((total, item) => total + item.content.byteLength, 0) });
}

function projectionId(request: FoundationProjectionRequest): string {
  const identity = selfDigest({ requestDigest: request.digest, compilerDigest: FOUNDATION_PROJECTION_COMPILER_IDENTITY.digest });
  return `projection:${identity.slice("sha256:".length)}`;
}

function validationProfile(request: FoundationProjectionRequest | null): "orientation-projection-v1" | "execution-projection-v1" {
  return request?.class === "execution" ? "execution-projection-v1" : "orientation-projection-v1";
}

function diagnosticStage(code: string): (typeof STAGES)[number] {
  if (code.includes("request")) return "request";
  if (code.includes("basis") || code.includes("external-denied") || code.includes("knowledge-invalid")) return "basis";
  if (code.includes("too-large") || code.includes("bound")) return "bounds";
  if (["content", "digest", "index", "count", "order", "omission"].some((part) => code.includes(part))) return "content";
  return "closure";
}

function addFailure(collector: DiagnosticCollector, error: unknown): Readonly<{ code: string; stage: (typeof STAGES)[number] }> {
  const failure = asLifecycleError(error);
  const code = failure.code.startsWith("lifecycle.") ? failure.code : "lifecycle.projection.compiler-failure";
  const stage = diagnosticStage(failure.code);
  const observedFacts = diagnosticFacts(failure.observedFacts, failure.code);
  const message = error instanceof FoundationError && failure.code.startsWith("lifecycle.")
    ? failure.message
    : `Projection compilation failed during ${stage}`;
  const diagnostics = error instanceof FoundationError && error.diagnostics.length > 0
    ? Object.freeze(error.diagnostics.map(({ code: diagnosticCode, message }) =>
      Object.freeze({ code: diagnosticCode, message })
    ))
    : null;
  collector.add({
    stage,
    code,
    message,
    facts: diagnostics === null ? observedFacts : { ...observedFacts, diagnostics },
  });
  return Object.freeze({ code, stage });
}

function failureObservations(error: unknown): Record<string, number> {
  const facts = asLifecycleError(error).observedFacts;
  if (facts === null || typeof facts !== "object" || Array.isArray(facts)) return {};
  const source = facts as Record<string, unknown>;
  const mappings = [
    ["mandatoryItems", "observedMandatoryItems"],
    ["mandatoryBytes", "observedMandatoryBytes"],
    ["sourceBytes", "observedSourceBytes"],
    ["bytes", "observedOversizedItemBytes"],
  ] as const;
  return Object.fromEntries(mappings.flatMap(([sourceKey, resultKey]) => {
    const value = source[sourceKey];
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? [[resultKey, value]] : [];
  }));
}

function result(options: {
  collector: DiagnosticCollector;
  request: FoundationProjectionRequest | null;
  projection: FoundationCompiledProjection | null;
  contract: FoundationLoadedRepositoryEpoch["contract"];
  observedAt?: string;
  observed?: Record<string, number>;
  incompleteFrom?: (typeof STAGES)[number] | null;
}): FoundationProjectionResult {
  const profile = validationProfile(options.request);
  const validation = options.collector.result({
    profile,
    subjectKind: options.projection === null ? "projection-request" : "knowledge-projection",
    subjectId: options.projection?.manifest.projectionId ?? "unresolved-projection",
    subjectDigest: options.projection?.manifest.digest ?? options.request?.digest ?? null,
    subjectRevision: options.request?.digest ?? null,
    publicationDigest: options.contract.specification.publicationDigest,
    stages: STAGES.map((id, index) => ({
      id,
      complete: options.incompleteFrom === null || options.incompleteFrom === undefined
        ? true
        : index < STAGES.indexOf(options.incompleteFrom),
    })),
    limits: {
      ...(options.request === null ? {} : {
        maximumMandatoryItems: options.request.profile.maximumMandatoryItems,
        maximumMandatoryBytes: options.request.profile.maximumMandatoryBytes,
        maximumItemBytes: options.request.profile.maximumItemBytes,
        maximumReachableItems: options.request.profile.maximumReachableItems,
        maximumReachableBytes: options.request.profile.maximumReachableBytes,
        maximumSourceBytes: options.request.profile.maximumSourceBytes,
        maximumRelationshipDepth: options.request.profile.maximumRelationshipDepth,
      }),
      ...(options.observed ?? {}),
    },
    implementation: foundationValidationImplementation([profile], []),
    observedAt: options.observedAt,
  });
  return Object.freeze({ validation, projection: validation.complete && validation.valid ? options.projection : null });
}

function enforceBounds(options: {
  request: FoundationProjectionRequest;
  coreBytes: number;
  atlas: FoundationProjectionCountPair;
  mandatory: FoundationProjectionCountPair;
  implementation: FoundationProjectionCountPair;
  bindings: FoundationProjectionCountPair;
  sources: FoundationProjectionCountPair;
  reachable: FoundationProjectionCountPair;
  tierTwo: readonly { id: string; content: { byteLength: number } }[];
}): void {
  const { request } = options;
  const mandatoryItems = options.atlas.items + options.mandatory.items + options.implementation.items + options.bindings.items + options.sources.items;
  const mandatoryBytes = options.coreBytes + options.atlas.bytes + options.mandatory.bytes + options.implementation.bytes + options.bindings.bytes + options.sources.bytes;
  const oversized = options.tierTwo.filter((item) => item.content.byteLength > request.profile.maximumItemBytes)
    .map((item) => ({ id: item.id, bytes: item.content.byteLength }));
  if (mandatoryItems > request.profile.maximumMandatoryItems || mandatoryBytes > request.profile.maximumMandatoryBytes ||
      options.sources.bytes > request.profile.maximumSourceBytes || oversized.length > 0) {
    throw completeMandatoryProjectionSizeErrorV1(request, Object.freeze({
      mandatoryItems, mandatoryBytes, sourceBytes: options.sources.bytes,
      maximumMandatoryItems: request.profile.maximumMandatoryItems,
      maximumMandatoryBytes: request.profile.maximumMandatoryBytes,
      maximumItemBytes: request.profile.maximumItemBytes,
      maximumSourceBytes: request.profile.maximumSourceBytes,
      oversized: Object.freeze(oversized.map((item) => Object.freeze(item))),
    }));
  }
  if (options.reachable.items > request.profile.maximumReachableItems || options.reachable.bytes > request.profile.maximumReachableBytes) {
    throw new FoundationError("lifecycle.projection.bounds-invalid", "Reachable Projection material exceeds the selected profile", {
      observedFacts: { reachable: options.reachable, profile: request.profile.id },
    });
  }
}

async function orientation(
  request: FoundationOrientationProjectionRequest,
  input: FoundationOrientationCompilerInput,
): Promise<FoundationCompiledProjection> {
  if ("snapshot" in input.repository) throw new FoundationError("lifecycle.projection.basis-mismatch", "Orientation consumes one exact repository epoch, not a final execution snapshot");
  if (canonicalJson(input.knowledge.validation) !== canonicalJson(input.knowledge.observation.validation)) {
    throw new FoundationError("lifecycle.projection.knowledge-invalid", "Orientation Knowledge result and observation do not share one validation carrier");
  }
  assertOrientationProjectionRequestBasis({ request, loaded: input.repository, knowledge: input.knowledge.observation });
  const inventory = new ProjectionByteInventoryBuilder();
  const atlasCompilation = compileAtlasProjection({ loaded: input.repository, inventory, mode: "orientation" });
  const atlas = atlasCompilation.items;
  const compiled = await compileOrientation({
    request,
    loaded: input.repository,
    knowledge: input.knowledge.observation,
    inventory,
    atlasResourceIds: atlasCompilation.resourceIds,
  });
  const mandatory = Object.freeze([...compiled.mandatory].sort((left, right) =>
    (KNOWLEDGE_KIND_ORDER.get(left.kind ?? "") ?? 99) - (KNOWLEDGE_KIND_ORDER.get(right.kind ?? "") ?? 99) ||
    compareCodePoints(
      `${left.sourceIdentity}\0${revisionSortKey(left.revision)}\0${left.locator}\0${left.id}`,
      `${right.sourceIdentity}\0${revisionSortKey(right.revision)}\0${right.locator}\0${right.id}`,
    )));
  const implementation = Object.freeze([]);
  const mandatoryCount = bytesOf(mandatory);
  const atlasCount = bytesOf(atlas);
  const implementationCount = bytesOf(implementation);
  const bindingCount = bytesOf(compiled.bindings);
  const sourceCount = bytesOf(compiled.sources);
  const reachableCount = Object.freeze({ items: compiled.reachable.length, bytes: compiled.reachable.reduce((total, entry) => total + entry.byteLength, 0) });
  const coreBytes = Buffer.byteLength(canonicalJson(compiled.core), "utf8");
  enforceBounds({
    request,
    coreBytes,
    atlas: atlasCount,
    mandatory: mandatoryCount,
    implementation: implementationCount,
    bindings: bindingCount,
    sources: sourceCount,
    reachable: reachableCount,
    tierTwo: [...atlas, ...mandatory, ...compiled.bindings, ...compiled.sources],
  });
  const counts = Object.freeze({
    coreBytes,
    atlas: atlasCount,
    mandatory: mandatoryCount,
    implementation: implementationCount,
    bindings: bindingCount,
    sources: sourceCount,
    reachable: reachableCount,
    conflicts: compiled.conflicts.length,
    unresolved: compiled.unresolved.length,
    totalBytes: coreBytes + atlasCount.bytes + mandatoryCount.bytes + implementationCount.bytes + bindingCount.bytes + sourceCount.bytes + reachableCount.bytes,
  });
  const base = {
    schema: FOUNDATION_PROJECTION_SCHEMA,
    projectionId: projectionId(request),
    class: "orientation" as const,
    role: "reconnaissance" as const,
    profile: request.profile.id as "orientation-standard-v1" | "orientation-large-v1",
    profileDigest: request.profile.digest,
    compiler: FOUNDATION_PROJECTION_COMPILER_IDENTITY,
    specificationRevision: request.specificationRevision,
    basis: projectionBasis(request),
    core: compiled.core,
    atlas,
    mandatory,
    implementation,
    bindings: compiled.bindings,
    sources: compiled.sources,
    reachable: compiled.reachable,
    conflicts: compiled.conflicts,
    unresolved: compiled.unresolved,
    omission: compiled.omission,
    counts,
  };
  const manifest = Object.freeze({ ...base, digest: selfDigest(base as unknown as Record<string, unknown>) }) as FoundationKnowledgeProjection;
  const projection: FoundationCompiledProjection = Object.freeze({
    manifest,
    inventory: compiled.inventory,
    cacheKey: projectionCacheKey({ request, compilerDigest: FOUNDATION_PROJECTION_COMPILER_IDENTITY.digest, basis: manifest.basis }),
  });
  verifyCompiledProjection(projection);
  return projection;
}

async function execution(
  request: FoundationExecutionProjectionRequest,
  input: FoundationExecutionCompilerInput,
): Promise<FoundationCompiledProjection> {
  assertExecutionProjectionRequestBasis({ request, loaded: input.repository, repositoryValidation: input.repositoryValidation, knowledge: input.knowledge });
  assertExecutionProjectionSubject(request, input.subject);
  const inventory = new ProjectionByteInventoryBuilder();
  const atlas = compileAtlasProjection({
    loaded: input.repository,
    inventory,
    mode: "execution",
    sourceRoots: input.subject.sourceRoots,
  }).items;
  const compiled = await compileExecution({
    request,
    loaded: input.repository,
    knowledge: input.knowledge,
    subject: input.subject,
    inventory,
    candidateObservation: input.candidateObservation,
    integrationParent: input.integrationParent,
    integrationRecords: input.integrationRecords,
    failedIntegration: input.failedIntegration,
    builderRepair: input.builderRepair,
    candidateObjectRepository: input.candidateObjectRepository,
    workBoundary: input.workBoundary,
    checkReceipts: input.checkReceipts,
    agentWorkProducts: input.agentWorkProducts,
  });
  const mandatory = Object.freeze([...compiled.mandatory].sort((left, right) =>
    (KNOWLEDGE_KIND_ORDER.get(left.kind ?? "") ?? 99) - (KNOWLEDGE_KIND_ORDER.get(right.kind ?? "") ?? 99) ||
    compareCodePoints(
      `${left.sourceIdentity}\0${revisionSortKey(left.revision)}\0${left.locator}\0${left.id}`,
      `${right.sourceIdentity}\0${revisionSortKey(right.revision)}\0${right.locator}\0${right.id}`,
    )));
  const implementation = Object.freeze([...compiled.implementation].sort((left, right) =>
    compareCodePoints(`${left.path}\0${left.id}`, `${right.path}\0${right.id}`)));
  const bindings = Object.freeze([...compiled.bindings].sort((left, right) =>
    compareCodePoints(`${left.id}\0${left.compatibleCheckIds.join("\0")}`, `${right.id}\0${right.compatibleCheckIds.join("\0")}`)));
  const sources = Object.freeze([...compiled.sources].sort((left, right) =>
    compareCodePoints(`${left.reference}\0${left.revision ?? ""}\0${left.id}`, `${right.reference}\0${right.revision ?? ""}\0${right.id}`)));
  const reachable = Object.freeze([...compiled.reachable].sort((left, right) => {
    const categories = compiled.omission.eligibleCategories;
    return categories.indexOf(left.category) - categories.indexOf(right.category) ||
      compareCodePoints(`${left.id}\0${left.handle}`, `${right.id}\0${right.handle}`);
  }));
  const conflicts = Object.freeze([...compiled.conflicts].sort((left, right) =>
    compareCodePoints(`${left.code}\0${left.id}`, `${right.code}\0${right.id}`)));
  const unresolved = Object.freeze([...compiled.unresolved].sort((left, right) =>
    compareCodePoints(
      `${left.required ? "0" : "1"}\0${left.reference}\0${left.id}`,
      `${right.required ? "0" : "1"}\0${right.reference}\0${right.id}`,
    )));
  const mandatoryCount = bytesOf(mandatory);
  const atlasCount = bytesOf(atlas);
  const implementationCount = bytesOf(implementation);
  const bindingCount = bytesOf(bindings);
  const sourceCount = bytesOf(sources);
  const reachableCount = Object.freeze({
    items: reachable.length,
    bytes: reachable.reduce((total, entry) => total + entry.byteLength, 0),
  });
  const coreBytes = Buffer.byteLength(canonicalJson(input.subject.core), "utf8");
  enforceBounds({
    request,
    coreBytes,
    atlas: atlasCount,
    mandatory: mandatoryCount,
    implementation: implementationCount,
    bindings: bindingCount,
    sources: sourceCount,
    reachable: reachableCount,
    tierTwo: [...atlas, ...mandatory, ...implementation, ...bindings, ...sources],
  });
  const counts = Object.freeze({
    coreBytes,
    atlas: atlasCount,
    mandatory: mandatoryCount,
    implementation: implementationCount,
    bindings: bindingCount,
    sources: sourceCount,
    reachable: reachableCount,
    conflicts: conflicts.length,
    unresolved: unresolved.length,
    totalBytes: coreBytes + atlasCount.bytes + mandatoryCount.bytes + implementationCount.bytes + bindingCount.bytes + sourceCount.bytes + reachableCount.bytes,
  });
  const base = {
    schema: FOUNDATION_PROJECTION_SCHEMA,
    projectionId: projectionId(request),
    class: "execution" as const,
    role: request.role,
    profile: request.profile.id as "execution-standard-v1" | "execution-large-v1",
    profileDigest: request.profile.digest,
    compiler: FOUNDATION_PROJECTION_COMPILER_IDENTITY,
    specificationRevision: request.specificationRevision,
    basis: projectionBasis(request),
    core: input.subject.core,
    atlas,
    mandatory,
    implementation,
    bindings,
    sources,
    reachable,
    conflicts,
    unresolved,
    omission: compiled.omission,
    counts,
  };
  const manifest = Object.freeze({ ...base, digest: selfDigest(base as unknown as Record<string, unknown>) }) as FoundationKnowledgeProjection;
  const projection: FoundationCompiledProjection = Object.freeze({
    manifest,
    inventory: compiled.inventory,
    cacheKey: projectionCacheKey({
      request,
      compilerDigest: FOUNDATION_PROJECTION_COMPILER_IDENTITY.digest,
      basis: manifest.basis,
      executionSubject: input.subject,
    }),
  });
  verifyCompiledProjection(projection);
  return projection;
}

export async function compileKnowledgeProjection(input: FoundationProjectionCompilerInput): Promise<FoundationProjectionResult> {
  const collector = new DiagnosticCollector();
  let request: FoundationProjectionRequest | null = null;
  let projection: FoundationCompiledProjection | null = null;
  let observed: Record<string, number> = {};
  let incompleteFrom: (typeof STAGES)[number] | null = null;
  let mandatoryRefusal: FoundationMandatoryProjectionRefusalV1 | null = null;
  try {
    request = parseProjectionRequest(input.request);
    if (request.class === "orientation") {
      if (!("observation" in input.knowledge) || "repositoryValidation" in input) {
        throw new FoundationError("lifecycle.projection.basis-mismatch", "Orientation compiler input must carry one exact epoch and partial Knowledge observation");
      }
      projection = await orientation(request, input as FoundationOrientationCompilerInput);
    } else {
      if (!("snapshot" in input.repository) || !("repositoryValidation" in input) || !("subject" in input) || "observation" in input.knowledge) {
        throw new FoundationError("lifecycle.projection.basis-mismatch", "Execution compiler input must carry one exact Snapshot, valid Knowledge Set, and execution data subject");
      }
      projection = await execution(request, input as FoundationExecutionCompilerInput);
    }
    observed = {
      observedMandatoryItems: projection.manifest.counts.atlas.items + projection.manifest.counts.mandatory.items + projection.manifest.counts.implementation.items + projection.manifest.counts.bindings.items + projection.manifest.counts.sources.items,
      observedMandatoryBytes: projection.manifest.counts.coreBytes + projection.manifest.counts.atlas.bytes + projection.manifest.counts.mandatory.bytes + projection.manifest.counts.implementation.bytes + projection.manifest.counts.bindings.bytes + projection.manifest.counts.sources.bytes,
      observedReachableItems: projection.manifest.counts.reachable.items,
      observedReachableBytes: projection.manifest.counts.reachable.bytes,
      observedSourceBytes: projection.manifest.counts.sources.bytes,
    };
  } catch (error) {
    mandatoryRefusal = bindFoundationMandatoryProjectionRefusalV1(error, request);
    const failure = addFailure(collector, error);
    observed = failureObservations(error);
    if (failure.stage === "content" || failure.stage === "bounds" || failure.code.includes("enumeration")) incompleteFrom = failure.stage;
  }
  const compiled = result({ collector, request, projection, contract: input.repository.contract, observedAt: input.observedAt, observed, incompleteFrom });
  if (mandatoryRefusal !== null) retainFoundationMandatoryProjectionRefusalV1(compiled, mandatoryRefusal);
  return compiled;
}
