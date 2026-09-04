import { FoundationError } from "../error.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  type FoundationCandidateRevisionCarrierManifestV1,
} from "../candidate/carrier-types.js";
import { parseCandidateRevisionCarrierManifest } from "../candidate/carrier-manifest.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";

const EXECUTION_INPUT_SET_SCHEMA_ID =
  "urn:lifecycle:schema:execution-input-set:v1";

const SUBJECT_KINDS = Object.freeze([
  "candidate-revision",
  "candidate-revision-carrier-manifest",
  "product-base",
  "product-base-object-closure-manifest",
  "projection",
  "role-subject",
  "founder-direction",
  "role-brief",
  "semantic-template",
  "capability-profile",
  "provider-descriptor",
  "investment",
  "check-definition",
  "check-binding",
  "check-proof-subject",
  "policy",
  "runner",
] as const);

const AGENT_SINGLETON_KINDS = Object.freeze([
  "projection",
  "role-subject",
  "founder-direction",
  "role-brief",
  "semantic-template",
  "capability-profile",
  "provider-descriptor",
  "investment",
  "runner",
] as const);

const CHECK_COMMON_SINGLETON_KINDS = Object.freeze([
  "check-definition",
  "check-binding",
  "check-proof-subject",
  "runner",
] as const);

export type FoundationExecutionInputSubjectKindV1 = typeof SUBJECT_KINDS[number];

export type FoundationExecutionInputSetOwnerV1 =
  | Readonly<{
      kind: "agent-attempt";
      activityId: string;
      attemptId: string;
      role: "reconnaissance" | "builder" | "reviewer";
      ownerSubjectDigest: Sha256;
    }>
  | Readonly<{
      kind: "check";
      activityId: string;
      selectionId: string;
      phase: "baseline" | "final";
      ownerSubjectDigest: Sha256;
    }>;

export type FoundationExecutionInputSubjectV1 = Readonly<{
  kind: FoundationExecutionInputSubjectKindV1;
  id: string;
  revision: number | null;
  digest: Sha256;
}>;

export type FoundationExecutionInputEntryPurposeV1 =
  | "candidate-carrier-artifact"
  | "product-base-object-closure-artifact"
  | "projection"
  | "role-brief"
  | "semantic-template"
  | "check-input"
  | "policy"
  | "operation-input";

export type FoundationExecutionInputEntryV1 = Readonly<{
  path: string;
  purpose: FoundationExecutionInputEntryPurposeV1;
  mediaType: string;
  modeClass: "regular" | "executable";
  byteLength: number;
  digest: Sha256;
  sourceSubjectDigest: Sha256;
}>;

export type FoundationExecutionInputSetV1 = Readonly<{
  schema: "lifecycle.execution-input-set.v1";
  owner: FoundationExecutionInputSetOwnerV1;
  inputMaterialDigest: Sha256;
  subjects: readonly FoundationExecutionInputSubjectV1[];
  entries: readonly FoundationExecutionInputEntryV1[];
  entryCount: number;
  aggregateByteLength: number;
  contentInventoryDigest: Sha256;
  runnerContractDigest: Sha256;
  toolInventoryDigest: Sha256;
  digest: Sha256;
}>;

export type FoundationExecutionInputEntryPlanV1 = Readonly<{
  path: string;
  purpose: FoundationExecutionInputEntryPurposeV1;
  mediaType: string;
  modeClass: "regular" | "executable";
  sourceSubjectDigest: Sha256;
}>;

export type FoundationExecutionInputCandidateBindingV1 = Readonly<{
  carrierManifestFileDigest: Sha256;
  rootTree: string;
}>;

/**
 * Stable proof returned by an injected owner that has independently reopened
 * one immutable logical subject. Bytes are copied and checked at this seam;
 * they are never retained in the Input Set.
 */
export type FoundationVerifiedExecutionInputSubjectV1 = Readonly<{
  subject: FoundationExecutionInputSubjectV1;
  immutable: true;
  byteLength: number;
  bytesDigest: Sha256;
  bytes: Uint8Array;
  candidateBinding: FoundationExecutionInputCandidateBindingV1 | null;
}>;

/** One independently reopened immutable entry and its complete descriptor. */
export type FoundationVerifiedExecutionInputEntryV1 = Readonly<{
  descriptor: FoundationExecutionInputEntryV1;
  immutable: true;
  bytes: Uint8Array;
}>;

/** Runtime-private verification seam. It supplies no path or storage handle. */
export type FoundationExecutionInputResolverV1 = Readonly<{
  verifySubject(
    subject: FoundationExecutionInputSubjectV1,
  ): Promise<FoundationVerifiedExecutionInputSubjectV1>;
  verifyEntry(
    entry: FoundationExecutionInputEntryPlanV1,
  ): Promise<FoundationVerifiedExecutionInputEntryV1>;
}>;

export type FoundationExecutionInputSetCompilationV1 = Readonly<{
  owner: FoundationExecutionInputSetOwnerV1;
  inputMaterialDigest: Sha256;
  subjects: readonly FoundationExecutionInputSubjectV1[];
  entries: readonly FoundationExecutionInputEntryPlanV1[];
  runnerContractDigest: Sha256;
  toolInventoryDigest: Sha256;
  resolver: FoundationExecutionInputResolverV1;
}>;

type VerifiedSubject = Readonly<{
  subject: FoundationExecutionInputSubjectV1;
  bytes: Uint8Array;
  candidateBinding: FoundationExecutionInputCandidateBindingV1 | null;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.execution.input-set.${code}`, message);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function canonicalCopy<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    fail("aggregate", "Execution Input Set aggregate byte length exceeds the safe-integer domain");
  }
  return result;
}

function compareSubjects(
  left: FoundationExecutionInputSubjectV1,
  right: FoundationExecutionInputSubjectV1,
): number {
  const kind = compareCodePoints(left.kind, right.kind);
  if (kind !== 0) return kind;
  const id = compareCodePoints(left.id, right.id);
  if (id !== 0) return id;
  if (left.revision !== right.revision) {
    if (left.revision === null) return -1;
    if (right.revision === null) return 1;
    return left.revision < right.revision ? -1 : 1;
  }
  return compareCodePoints(left.digest, right.digest);
}

function assertSubjectOrder(subjects: readonly FoundationExecutionInputSubjectV1[]): void {
  const digests = new Set<Sha256>();
  for (let index = 0; index < subjects.length; index += 1) {
    const subject = subjects[index]!;
    if (index > 0 && compareSubjects(subjects[index - 1]!, subject) >= 0) {
      fail("subject-order", "Execution Input Set subjects are not in strict canonical order");
    }
    if (digests.has(subject.digest)) {
      fail("subject-digest", "Execution Input Set subject digests do not resolve uniquely");
    }
    digests.add(subject.digest);
  }
}

function assertEntryPaths(entries: readonly FoundationExecutionInputEntryV1[]): void {
  const paths = new Set<string>();
  const aliases = new Map<string, string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (index > 0 && compareCodePoints(entries[index - 1]!.path, entry.path) >= 0) {
      fail("entry-order", "Execution Input Set entries are not in strict path order");
    }
    const segments = entry.path.split("/");
    for (let end = 1; end <= segments.length; end += 1) {
      const prefix = segments.slice(0, end).join("/");
      const alias = prefix.normalize("NFC").toLowerCase();
      const prior = aliases.get(alias);
      if (prior !== undefined && prior !== prefix) {
        fail("path-alias", "Execution Input Set paths contain a case or Unicode-normalization alias");
      }
      aliases.set(alias, prefix);
      if (end < segments.length && paths.has(prefix)) {
        fail("path-prefix", "Execution Input Set inventories a file as another file's directory");
      }
    }
    paths.add(entry.path);
  }
}

function subjectsByKind(
  subjects: readonly FoundationExecutionInputSubjectV1[],
): ReadonlyMap<FoundationExecutionInputSubjectKindV1, readonly FoundationExecutionInputSubjectV1[]> {
  const grouped = new Map<FoundationExecutionInputSubjectKindV1, FoundationExecutionInputSubjectV1[]>();
  for (const subject of subjects) {
    const selected = grouped.get(subject.kind) ?? [];
    selected.push(subject);
    grouped.set(subject.kind, selected);
  }
  return grouped;
}

function requireSingletonKinds(
  grouped: ReadonlyMap<FoundationExecutionInputSubjectKindV1, readonly FoundationExecutionInputSubjectV1[]>,
  kinds: readonly FoundationExecutionInputSubjectKindV1[],
): void {
  for (const kind of kinds) {
    if (grouped.get(kind)?.length !== 1) {
      fail("subject-policy", `Execution Input Set requires exactly one ${kind} subject`);
    }
  }
}

function assertOwnerSubjectPolicy(value: FoundationExecutionInputSetV1): void {
  const grouped = subjectsByKind(value.subjects);
  const allowed = new Set<FoundationExecutionInputSubjectKindV1>();
  if (value.owner.kind === "agent-attempt") {
    for (const kind of AGENT_SINGLETON_KINDS) allowed.add(kind);
    allowed.add("policy");
    requireSingletonKinds(grouped, AGENT_SINGLETON_KINDS);
    if ((grouped.get("policy")?.length ?? 0) < 1) {
      fail("subject-policy", "Agent Execution Input Sets require at least one policy subject");
    }
    if (value.owner.role === "reconnaissance") {
      if (grouped.has("candidate-revision") ||
          grouped.has("candidate-revision-carrier-manifest")) {
        fail("candidate-policy", "Reconnaissance Input Sets cannot bind Candidate subjects");
      }
    } else {
      allowed.add("candidate-revision");
      allowed.add("candidate-revision-carrier-manifest");
      requireSingletonKinds(grouped, [
        "candidate-revision",
        "candidate-revision-carrier-manifest",
      ]);
    }
  } else {
    for (const kind of CHECK_COMMON_SINGLETON_KINDS) allowed.add(kind);
    allowed.add("policy");
    requireSingletonKinds(grouped, CHECK_COMMON_SINGLETON_KINDS);
    if (value.owner.phase === "baseline") {
      allowed.add("product-base");
      allowed.add("product-base-object-closure-manifest");
      requireSingletonKinds(grouped, [
        "product-base",
        "product-base-object-closure-manifest",
      ]);
    } else {
      allowed.add("candidate-revision");
      allowed.add("candidate-revision-carrier-manifest");
      requireSingletonKinds(grouped, [
        "candidate-revision",
        "candidate-revision-carrier-manifest",
      ]);
    }
  }
  for (const [kind, subjects] of grouped) {
    if (!allowed.has(kind)) {
      fail("subject-policy", `Execution Input Set owner forbids ${kind} subjects`);
    }
    if (kind !== "policy" && subjects.length > 1) {
      fail("subject-policy", `Execution Input Set cannot bind multiple ${kind} subjects`);
    }
  }
  const runner = grouped.get("runner")![0]!;
  if (runner.digest !== value.runnerContractDigest) {
    fail("runner-binding", "Execution Input Set runner subject does not match runnerContractDigest");
  }
  const ownerSubjectKind = value.owner.kind === "agent-attempt"
    ? "role-subject"
    : "check-proof-subject";
  if (grouped.get(ownerSubjectKind)![0]!.digest !== value.owner.ownerSubjectDigest) {
    fail(
      "owner-binding",
      `Execution Input Set ownerSubjectDigest does not bind its exact ${ownerSubjectKind}`,
    );
  }
}

function assertEntrySources(value: FoundationExecutionInputSetV1): void {
  const subjects = new Map(value.subjects.map((subject) => [subject.digest, subject]));
  for (const entry of value.entries) {
    if (!subjects.has(entry.sourceSubjectDigest)) {
      fail("entry-source", "Execution Input Set entry source does not resolve to an exact subject");
    }
  }
  const artifacts = value.entries.filter(
    (entry) => entry.purpose === "candidate-carrier-artifact",
  );
  const productBaseArtifacts = value.entries.filter(
    (entry) => entry.purpose === "product-base-object-closure-artifact",
  );
  const needsCandidate = value.owner.kind === "check"
    ? value.owner.phase === "final"
    : value.owner.role === "builder" || value.owner.role === "reviewer";
  if (needsCandidate ? artifacts.length !== 1 : artifacts.length !== 0) {
    fail(
      "candidate-policy",
      needsCandidate
        ? "Execution Input Set requires exactly one Candidate Carrier artifact"
        : "This Execution Input Set cannot bind a Candidate Carrier artifact",
    );
  }
  const needsProductBase = value.owner.kind === "check" && value.owner.phase === "baseline";
  if (needsProductBase ? productBaseArtifacts.length !== 1 : productBaseArtifacts.length !== 0) {
    fail(
      "product-base-policy",
      needsProductBase
        ? "Baseline Check Input Sets require exactly one product-base object-closure artifact"
        : "Only baseline Check Input Sets may bind a product-base object-closure artifact",
    );
  }
}

function assertDerivedFields(value: FoundationExecutionInputSetV1): void {
  if (value.entryCount !== value.entries.length) {
    fail("entry-count", "Execution Input Set entryCount does not match entries");
  }
  const aggregate = value.entries.reduce(
    (sum, entry) => safeAdd(sum, entry.byteLength),
    0,
  );
  if (aggregate !== value.aggregateByteLength) {
    fail("aggregate", "Execution Input Set aggregateByteLength does not match entries");
  }
  if (value.contentInventoryDigest !== digestCanonical(value.entries)) {
    fail("inventory-digest", "Execution Input Set contentInventoryDigest does not match entries");
  }
  if (value.digest !== selfDigest(value as unknown as Record<string, unknown>)) {
    fail("digest", "Execution Input Set self-digest does not match its exact value");
  }
}

function semanticInputSet(value: FoundationExecutionInputSetV1): void {
  assertSubjectOrder(value.subjects);
  assertEntryPaths(value.entries);
  assertOwnerSubjectPolicy(value);
  assertEntrySources(value);
  assertDerivedFields(value);
}

function resolverMethods(resolver: FoundationExecutionInputResolverV1): Readonly<{
  verifySubject: FoundationExecutionInputResolverV1["verifySubject"];
  verifyEntry: FoundationExecutionInputResolverV1["verifyEntry"];
}> {
  if (resolver === null || typeof resolver !== "object" || Array.isArray(resolver) ||
      typeof resolver.verifySubject !== "function" || typeof resolver.verifyEntry !== "function") {
    fail("resolver", "Execution Input Set requires one complete private verification resolver");
  }
  return Object.freeze({
    verifySubject: resolver.verifySubject.bind(resolver),
    verifyEntry: resolver.verifyEntry.bind(resolver),
  });
}

async function verifiedSubjects(
  subjects: readonly FoundationExecutionInputSubjectV1[],
  resolver: ReturnType<typeof resolverMethods>,
): Promise<ReadonlyMap<Sha256, VerifiedSubject>> {
  const verified = new Map<Sha256, VerifiedSubject>();
  for (const subject of subjects) {
    let proof: FoundationVerifiedExecutionInputSubjectV1;
    try {
      proof = await resolver.verifySubject(subject);
    } catch (error) {
      if (error instanceof FoundationError) throw error;
      fail("resolution", `Execution Input Set subject ${subject.kind} could not be independently verified`);
    }
    if (proof === null || typeof proof !== "object" || proof.immutable !== true ||
        !sameValue(proof.subject, subject) || !(proof.bytes instanceof Uint8Array)) {
      fail("subject-proof", "Execution Input Set subject proof is incomplete or substituted");
    }
    const bytes = Uint8Array.from(proof.bytes);
    if (!Number.isSafeInteger(proof.byteLength) || proof.byteLength !== bytes.byteLength ||
        proof.bytesDigest !== sha256Bytes(bytes)) {
      fail("subject-proof", "Execution Input Set subject proof does not match its exact bytes");
    }
    if (subject.kind === "candidate-revision") {
      const binding = proof.candidateBinding;
      if (binding === null || typeof binding !== "object" ||
          typeof binding.rootTree !== "string" || binding.rootTree.length === 0 ||
          typeof binding.carrierManifestFileDigest !== "string") {
        fail("candidate-binding", "Candidate Revision proof lacks one exact Carrier binding");
      }
    } else if (proof.candidateBinding !== null) {
      fail("candidate-binding", "Only a Candidate Revision proof may carry a Carrier binding");
    }
    verified.set(subject.digest, Object.freeze({
      subject,
      bytes,
      candidateBinding: proof.candidateBinding === null
        ? null
        : Object.freeze({ ...proof.candidateBinding }),
    }));
  }
  return verified;
}

async function verifiedEntry(
  plan: FoundationExecutionInputEntryPlanV1,
  resolver: ReturnType<typeof resolverMethods>,
  expected?: FoundationExecutionInputEntryV1,
): Promise<FoundationExecutionInputEntryV1> {
  let proof: FoundationVerifiedExecutionInputEntryV1;
  try {
    proof = await resolver.verifyEntry(plan);
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    fail("resolution", `Execution Input Set entry ${plan.path} could not be independently verified`);
  }
  if (proof === null || typeof proof !== "object" || proof.immutable !== true ||
      !(proof.bytes instanceof Uint8Array)) {
    fail("entry-proof", "Execution Input Set entry proof is incomplete");
  }
  const bytes = Uint8Array.from(proof.bytes);
  const derived = Object.freeze({
    ...plan,
    byteLength: bytes.byteLength,
    digest: sha256Bytes(bytes),
  });
  if (!sameValue(proof.descriptor, derived) ||
      (expected !== undefined && !sameValue(expected, derived))) {
    fail("entry-proof", "Execution Input Set entry descriptor is substituted or does not match its bytes");
  }
  return derived;
}

function assertCandidateBinding(
  value: FoundationExecutionInputSetV1,
  subjects: ReadonlyMap<Sha256, VerifiedSubject>,
): void {
  const candidateSubject = value.subjects.find(
    (subject) => subject.kind === "candidate-revision",
  );
  if (candidateSubject === undefined) return;
  const manifestSubject = value.subjects.find(
    (subject) => subject.kind === "candidate-revision-carrier-manifest",
  );
  if (manifestSubject === undefined) {
    fail("candidate-binding", "Candidate Revision lacks its Carrier manifest subject");
  }
  const candidate = subjects.get(candidateSubject.digest)!;
  const manifestProof = subjects.get(manifestSubject.digest)!;
  let manifest: FoundationCandidateRevisionCarrierManifestV1;
  try {
    manifest = parseCandidateRevisionCarrierManifest(
      manifestProof.bytes,
      FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    );
  } catch {
    fail("candidate-binding", "Candidate Revision Carrier manifest bytes are invalid");
  }
  if (sha256Bytes(manifestProof.bytes) !== manifestSubject.digest ||
      candidate.candidateBinding?.carrierManifestFileDigest !== manifestSubject.digest ||
      candidate.candidateBinding.rootTree !== manifest.rootTree) {
    fail("candidate-binding", "Candidate Revision and Carrier manifest bindings do not agree");
  }
  const artifact = value.entries.find(
    (entry) => entry.purpose === "candidate-carrier-artifact",
  )!;
  if (artifact.sourceSubjectDigest !== manifestSubject.digest ||
      artifact.byteLength !== manifest.carrierArtifact.byteLength ||
      artifact.digest !== manifest.carrierArtifact.digest) {
    fail("candidate-binding", "Candidate Carrier artifact does not match its exact manifest");
  }
}

function exactCanonicalJson(bytes: Uint8Array, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail("product-base-binding", `${label} is not exact JSON`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !Buffer.from(bytes).equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail("product-base-binding", `${label} is not one canonical JSON object`);
  }
  return value as Record<string, unknown>;
}

function assertProductBaseBinding(
  value: FoundationExecutionInputSetV1,
  subjects: ReadonlyMap<Sha256, VerifiedSubject>,
): void {
  if (value.owner.kind !== "check" || value.owner.phase !== "baseline") return;
  const productBaseSubject = value.subjects.find(({ kind }) => kind === "product-base")!;
  const manifestSubject = value.subjects.find(
    ({ kind }) => kind === "product-base-object-closure-manifest",
  )!;
  const productBaseProof = subjects.get(productBaseSubject.digest)!;
  const manifestProof = subjects.get(manifestSubject.digest)!;
  if (sha256Bytes(productBaseProof.bytes) !== productBaseSubject.digest ||
      sha256Bytes(manifestProof.bytes) !== manifestSubject.digest) {
    fail("product-base-binding", "Baseline product-base subjects do not bind their exact bytes");
  }
  const productBase = exactCanonicalJson(productBaseProof.bytes, "Baseline product-base subject");
  const manifest = exactCanonicalJson(manifestProof.bytes, "Baseline product-base object-closure manifest");
  if (Object.keys(productBase).sort().join("\0") !==
        ["commit", "objectFormat", "proofSubjectDigest", "schema", "tree"].sort().join("\0") ||
      productBase.schema !== "lifecycle.check-product-base.v1" ||
      productBase.proofSubjectDigest !== value.owner.ownerSubjectDigest ||
      !(productBase.objectFormat === "sha1" || productBase.objectFormat === "sha256") ||
      typeof productBase.commit !== "string" || typeof productBase.tree !== "string") {
    fail("product-base-binding", "Baseline product-base subject failed its exact identity");
  }
  const oid = new RegExp(productBase.objectFormat === "sha1"
    ? "^[a-f0-9]{40}$"
    : "^[a-f0-9]{64}$", "u");
  if (!oid.test(productBase.commit) || !oid.test(productBase.tree) ||
      Object.keys(manifest).sort().join("\0") !== [
        "aggregateObjectBytes", "allowedTreeModes", "artifact", "baseCommit", "digest",
        "objectCount", "objectFormat", "objectInventory", "objectInventoryDigest",
        "productBaseDigest", "rootTree", "schema",
      ].sort().join("\0") ||
      manifest.schema !== "lifecycle.check-product-base-object-closure.v1" ||
      manifest.digest !== selfDigest(manifest) ||
      manifest.productBaseDigest !== productBaseSubject.digest ||
      manifest.objectFormat !== productBase.objectFormat ||
      manifest.baseCommit !== productBase.commit || manifest.rootTree !== productBase.tree) {
    fail("product-base-binding", "Baseline product-base object closure changes its exact subject");
  }
  const artifactDescriptor = manifest.artifact;
  if (artifactDescriptor === null || typeof artifactDescriptor !== "object" ||
      Array.isArray(artifactDescriptor)) {
    fail("product-base-binding", "Baseline product-base object closure lacks one artifact descriptor");
  }
  const artifact = value.entries.find(
    (entry) => entry.purpose === "product-base-object-closure-artifact",
  )!;
  const descriptor = artifactDescriptor as Record<string, unknown>;
  if (Object.keys(descriptor).sort().join("\0") !== ["byteLength", "digest", "format"].join("\0") ||
      descriptor.format !== "git-pack-v2" || artifact.sourceSubjectDigest !== manifestSubject.digest ||
      artifact.byteLength !== descriptor.byteLength || artifact.digest !== descriptor.digest) {
    fail("product-base-binding", "Baseline product-base object-closure artifact differs from its manifest");
  }
}

async function verifyCompleteInputSet(
  value: FoundationExecutionInputSetV1,
  resolverValue: FoundationExecutionInputResolverV1,
): Promise<void> {
  const resolver = resolverMethods(resolverValue);
  const subjects = await verifiedSubjects(value.subjects, resolver);
  for (const entry of value.entries) {
    await verifiedEntry({
      path: entry.path,
      purpose: entry.purpose,
      mediaType: entry.mediaType,
      modeClass: entry.modeClass,
      sourceSubjectDigest: entry.sourceSubjectDigest,
    }, resolver, entry);
  }
  assertCandidateBinding(value, subjects);
  assertProductBaseBinding(value, subjects);
}

/** Compile one immutable logical Input Set before its owning Attempt or Check. */
export async function compileFoundationExecutionInputSet(
  input: FoundationExecutionInputSetCompilationV1,
): Promise<FoundationExecutionInputSetV1> {
  const resolver = resolverMethods(input.resolver);
  const owner = canonicalCopy(input.owner);
  const subjects = [...canonicalCopy(input.subjects)].sort(compareSubjects);
  const entries: FoundationExecutionInputEntryV1[] = [];
  for (const planValue of input.entries) {
    const plan = canonicalCopy(planValue);
    entries.push(await verifiedEntry(plan, resolver));
  }
  entries.sort((left, right) => compareCodePoints(left.path, right.path));
  const aggregateByteLength = entries.reduce(
    (sum, entry) => safeAdd(sum, entry.byteLength),
    0,
  );
  const subject = {
    schema: "lifecycle.execution-input-set.v1" as const,
    owner,
    inputMaterialDigest: input.inputMaterialDigest,
    subjects,
    entries,
    entryCount: entries.length,
    aggregateByteLength,
    contentInventoryDigest: digestCanonical(entries),
    runnerContractDigest: input.runnerContractDigest,
    toolInventoryDigest: input.toolInventoryDigest,
  };
  const value = deepFreeze({ ...subject, digest: selfDigest(subject) });
  assertFoundationSchema(EXECUTION_INPUT_SET_SCHEMA_ID, value, "Execution Input Set");
  semanticInputSet(value);
  const verified = await verifiedSubjects(value.subjects, resolver);
  assertCandidateBinding(value, verified);
  assertProductBaseBinding(value, verified);
  return value;
}

/** Parse and independently re-resolve one retained logical Input Set. */
export async function parseFoundationExecutionInputSet(input: Readonly<{
  value: unknown;
  resolver: FoundationExecutionInputResolverV1;
}>): Promise<FoundationExecutionInputSetV1> {
  assertFoundationSchema(EXECUTION_INPUT_SET_SCHEMA_ID, input.value, "Execution Input Set");
  const value = deepFreeze(canonicalCopy(input.value) as FoundationExecutionInputSetV1);
  semanticInputSet(value);
  await verifyCompleteInputSet(value, input.resolver);
  return value;
}
