import { FoundationSemanticMarkdownSchema } from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";
import { FOUNDATION_DOCKER_CHECK_ENVIRONMENT_GUIDANCE } from "../check/environment-requirements.js";
import { decodeInventoryBytes } from "../projection/content.js";
import { unambiguousKnowledgeAliases } from "../projection/knowledge-citations.js";
import type {
  FoundationCompiledProjection,
  FoundationProjectionContentLocator,
  FoundationProjectionPresentationHint,
} from "../projection/types.js";
import { verifyCompiledProjection } from "../projection/verification.js";
import {
  renderAgentWorkProductTemplate,
  createAgentWorkProductValidationBasis,
  agentWorkProductParserProfileDigest,
  agentWorkProductCompilerProfileDigest,
  FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
  FOUNDATION_AGENT_WORK_PRODUCT_LOCAL_HANDLE_GUIDANCE,
  FOUNDATION_AGENT_WORK_PRODUCT_REVIEW_GUIDANCE,
  FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_MAXIMUM_BYTES,
  FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
  type AgentWorkProductPropositionSet,
  type AgentWorkProductValidationBasis,
  type AgentWorkProductCitationRegistryEntry,
  type AgentWorkProductRole,
} from "../control/agent-work-product-semantics.js";
import { normalizeSemanticMarkdown } from "../control/model.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints, sortUniqueCodePoints } from "../validation/ordering.js";

export const PROVIDER_INPUT_V4_LAYOUT = "lifecycle.agent-provider-input.standard-v8" as const;
export const PROVIDER_INPUT_V4_INVENTORY_SCHEMA =
  "lifecycle.agent-input-content-inventory.v8" as const;
export const PROVIDER_INPUT_V4_MATERIAL_SCHEMA = "lifecycle.agent-input-material.v8" as const;
export const PROVIDER_INPUT_V4_MANIFEST_SCHEMA =
  "lifecycle.agent-input-bundle-manifest.v8" as const;
export const PROVIDER_INPUT_V4_TREE_SCHEMA = "lifecycle.agent-input-bundle-tree.v8" as const;

export const PROVIDER_INPUT_SEMANTIC_BASIS_PATH = "semantic-basis.json" as const;
export const PROVIDER_INPUT_SEMANTIC_BASIS_MAXIMUM_BYTES = FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_MAXIMUM_BYTES;

const MAXIMUM_ENTRIES = 65_535;
const MAXIMUM_ENTRY_BYTES = 256 * 1024 * 1024;
const MAXIMUM_TOTAL_BYTES = 1024 * 1024 * 1024;

export type ProviderInputV4Operation =
  | "delivery.prepare"
  | "delivery.continue"
  | "delivery.evaluate"
  | "delivery.revise"
  | "delivery.reaffirm";

export type ProviderInputV4Capability = Readonly<{
  candidateWrites: boolean;
  temporaryWrites: boolean;
  subprocesses: "none" | "repository-toolchain" | "repository-toolchain-and-docker";
  network: "none" | "loopback";
  credentials: "none";
  externalEffects: readonly string[];
}>;

export type ProviderInputV4Content = Readonly<{
  path: string;
  bytes: Uint8Array;
}>;

export type ProviderInputV4InventoryEntry = Readonly<{
  path: string;
  byteLength: number;
  digest: Sha256;
}>;

export type ProviderInputV4RoleBrief = Readonly<{
  markdown: string;
  digest: Sha256;
}>;

export type ProviderInputV4DirectorDirection = Readonly<{
  markdown: string;
  digest: Sha256;
  byteLength: number;
}>;

export type ProviderInputV4 = Readonly<{
  role: AgentWorkProductRole;
  operation: ProviderInputV4Operation;
  projectionDigest: Sha256;
  roleSubjectDigest: Sha256;
  rootTokenSetDigest: Sha256;
  capability: ProviderInputV4Capability;
  directorDirection: ProviderInputV4DirectorDirection;
  roleBrief: ProviderInputV4RoleBrief;
  semanticTemplate: ReturnType<typeof renderAgentWorkProductTemplate>;
  citationRegistry: readonly AgentWorkProductCitationRegistryEntry[];
  citationRegistryDigest: Sha256;
  propositionSet: AgentWorkProductPropositionSet | null;
  validationBasis: AgentWorkProductValidationBasis;
  contents: readonly ProviderInputV4Content[];
  inventory: Readonly<{
    schema: typeof PROVIDER_INPUT_V4_INVENTORY_SCHEMA;
    entries: readonly ProviderInputV4InventoryEntry[];
  }>;
  contentInventoryDigest: Sha256;
  inputMaterial: Readonly<{
    schema: typeof PROVIDER_INPUT_V4_MATERIAL_SCHEMA;
    layoutProfileId: typeof PROVIDER_INPUT_V4_LAYOUT;
    projectionDigest: Sha256;
    roleSubjectDigest: Sha256;
    directorDirectionDigest: Sha256;
    roleBriefDigest: Sha256;
    semanticTemplateDigest: Sha256;
    validationBasisDigest: Sha256;
    contentInventoryDigest: Sha256;
    rootTokenSetDigest: Sha256;
  }>;
  inputMaterialDigest: Sha256;
  manifestDigest: Sha256;
  bundleDigest: Sha256;
}>;

export type CompileProviderInputV4Options = Readonly<{
  projection: FoundationCompiledProjection;
  operation: ProviderInputV4Operation;
  roleSubjectDigest: Sha256;
  rootTokenSetDigest: Sha256;
  capability: ProviderInputV4Capability;
  directorSemanticMarkdown: string;
  propositionSet?: AgentWorkProductPropositionSet | null;
}>;

type SourceCategory = "atlas" | "knowledge" | "implementation" | "binding" | "source" | "reachable";

type ProjectedSource = Readonly<{
  category: SourceCategory;
  stableKey: string;
  citationId: string;
  citationKind: AgentWorkProductCitationRegistryEntry["kind"];
  citationDigest: Sha256;
  citationAlias?: string;
  knowledgeIdentity?: string;
  authorityClass: AgentWorkProductCitationRegistryEntry["authorityClass"];
  presentationHint: FoundationProjectionPresentationHint;
  useLimit: string | null;
  bytes: Buffer;
}>;

type MaterializedSource = ProjectedSource & Readonly<{ path: string }>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.attempt.provider-input-v4.${code}`, message);
}

function exactDigest(value: string, label: string): Sha256 {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) fail("binding", `${label} is not one exact SHA-256 digest`);
  return value as Sha256;
}

function normalizedCapability(input: ProviderInputV4Capability): ProviderInputV4Capability {
  if (typeof input.candidateWrites !== "boolean" || typeof input.temporaryWrites !== "boolean") {
    fail("capability", "Provider input capability write permissions must be exact booleans");
  }
  if (
    input.subprocesses !== "none" && input.subprocesses !== "repository-toolchain" &&
    input.subprocesses !== "repository-toolchain-and-docker"
  ) fail("capability", "Provider input uses an unsupported subprocess capability");
  if (input.network !== "none" && input.network !== "loopback") {
    fail("capability", "Provider input uses an unsupported network capability");
  }
  if (input.credentials !== "none") fail("capability", "Provider input cannot expose credentials");
  if (!Array.isArray(input.externalEffects) || input.externalEffects.length > 1_024) {
    fail("capability", "Provider input external effects must be one bounded array");
  }
  const externalEffects = Object.freeze(sortUniqueCodePoints(input.externalEffects.map((effect) => {
    if (
      typeof effect !== "string" || effect.length === 0 || effect.length > 512 ||
      effect !== effect.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(effect)
    ) fail("capability", "Provider input external effect is not bounded normalized text");
    return effect;
  })));
  return Object.freeze({
    candidateWrites: input.candidateWrites,
    temporaryWrites: input.temporaryWrites,
    subprocesses: input.subprocesses,
    network: input.network,
    credentials: input.credentials,
    externalEffects,
  });
}

function normalizedDirectorDirection(value: string): ProviderInputV4DirectorDirection {
  const parsed = FoundationSemanticMarkdownSchema.safeParse(value);
  if (!parsed.success) {
    fail(
      "director-direction",
      "Provider input Director direction must be exact body-only public semantic Markdown",
    );
  }
  const markdown = normalizeSemanticMarkdown(parsed.data);
  return Object.freeze({
    markdown,
    digest: sha256Bytes(markdown),
    byteLength: Buffer.byteLength(markdown, "utf8"),
  });
}

function roleForOperation(operation: ProviderInputV4Operation): AgentWorkProductRole {
  switch (operation) {
    case "delivery.continue": return "builder";
    case "delivery.evaluate": return "reviewer";
    case "delivery.prepare":
    case "delivery.revise":
    case "delivery.reaffirm": return "reconnaissance";
    default: return fail("operation", "Provider input uses an unsupported Delivery operation");
  }
}

function projectionRole(projection: FoundationCompiledProjection): AgentWorkProductRole {
  const role = projection.manifest.role;
  if (role !== "reconnaissance" && role !== "builder" && role !== "reviewer") {
    fail("role", "Provider input cannot dispatch an unsupported Projection role");
  }
  return role;
}

function contentBytes(
  content: FoundationProjectionContentLocator,
  mounted: ReadonlyMap<string, Buffer>,
): Buffer {
  if (content.mode === "inline") {
    const bytes = Buffer.from(content.text, "utf8");
    if (bytes.byteLength !== content.byteLength || sha256Bytes(bytes) !== content.digest) {
      fail("projection", "Projected inline content does not reproduce its exact byte facts");
    }
    return bytes;
  }
  const bytes = mounted.get(content.path);
  if (bytes === undefined || bytes.byteLength !== content.byteLength || sha256Bytes(bytes) !== content.digest) {
    fail("projection", "Projected mounted content is absent or differs from its exact byte facts");
  }
  return Buffer.from(bytes);
}

function sourceAuthority(
  authority: FoundationCompiledProjection["manifest"]["sources"][number]["authority"],
): AgentWorkProductCitationRegistryEntry["authorityClass"] {
  if (authority === "runtime-authenticated-fact" || authority === "repository-reality") {
    return "runtime-observed";
  }
  if (authority === "agent-proposed-claim") return "agent-proposed";
  return "repository-authored";
}

function sources(projection: FoundationCompiledProjection): readonly ProjectedSource[] {
  const mounted = new Map(projection.inventory.map((entry) => [entry.path, decodeInventoryBytes(entry)]));
  const values: ProjectedSource[] = [];
  for (const item of projection.manifest.atlas) {
    values.push(Object.freeze({
      category: "atlas",
      stableKey: `${item.unitKind}\u0000${item.unitId}\u0000${item.mapId ?? ""}\u0000${item.recordKind ?? ""}`,
      citationId: [
        "atlas",
        item.atlasId,
        item.unitKind,
        item.unitId,
        item.mapId ?? "-",
        item.recordKind ?? "-",
      ].join(":"),
      citationKind: "projection",
      citationDigest: item.normalizedDigest,
      authorityClass: "repository-authored",
      presentationHint: item.presentationHint,
      useLimit: item.useLimit,
      bytes: contentBytes(item.content, mounted),
    }));
  }
  const knowledgeAliases = unambiguousKnowledgeAliases(projection.manifest.mandatory);
  for (const item of projection.manifest.mandatory) {
    values.push(Object.freeze({
      category: "knowledge",
      stableKey: item.id,
      citationId: item.semanticDigest === null ? item.sourceIdentity : item.id,
      citationKind: item.semanticDigest === null ? "projection" : "knowledge",
      citationDigest: item.sourceDigest,
      ...(item.semanticDigest === null ? {} : { knowledgeIdentity: item.sourceIdentity }),
      ...(knowledgeAliases.has(item.id) ? { citationAlias: knowledgeAliases.get(item.id)! } : {}),
      authorityClass: "repository-authored",
      presentationHint: item.presentationHint,
      useLimit: item.useLimit,
      bytes: contentBytes(item.content, mounted),
    }));
  }
  for (const item of projection.manifest.implementation) {
    values.push(Object.freeze({
      category: "implementation",
      stableKey: item.id,
      citationId: item.id,
      citationKind: "projection",
      citationDigest: item.digest,
      authorityClass: "runtime-observed",
      presentationHint: item.presentationHint,
      useLimit: item.useLimit,
      bytes: contentBytes(item.content, mounted),
    }));
  }
  for (const item of projection.manifest.bindings) {
    values.push(Object.freeze({
      category: "binding",
      stableKey: item.id,
      citationId: item.id,
      citationKind: "projection",
      citationDigest: item.bindingDigest,
      authorityClass: "runtime-derived",
      presentationHint: item.presentationHint,
      useLimit: item.useLimit,
      bytes: contentBytes(item.content, mounted),
    }));
  }
  for (const item of projection.manifest.sources) {
    const kind = item.semantic.class === "source"
      ? "source"
      : item.semantic.class === "candidate"
        ? "candidate"
        : "evidence";
    values.push(Object.freeze({
      category: "source",
      stableKey: item.id,
      citationId: item.semantic.subjectId,
      citationKind: kind,
      citationDigest: item.semantic.subjectDigest,
      authorityClass: sourceAuthority(item.authority),
      presentationHint: item.presentationHint,
      useLimit: item.useLimit,
      bytes: contentBytes(item.content, mounted),
    }));
  }
  for (const item of projection.manifest.reachable) {
    if (item.retrieval !== "mounted" || item.mountedPath === null) continue;
    const bytes = mounted.get(item.mountedPath);
    if (bytes === undefined || bytes.byteLength !== item.byteLength || sha256Bytes(bytes) !== item.digest) {
      fail("projection", `Mounted reachable source ${item.id} differs from its exact inventory bytes`);
    }
    values.push(Object.freeze({
      category: "reachable",
      stableKey: `${item.id}\u0000${item.handle}`,
      citationId: item.id,
      citationKind: "projection",
      citationDigest: item.digest,
      authorityClass: "runtime-derived",
      presentationHint: "plain-text",
      useLimit: null,
      bytes: Buffer.from(bytes),
    }));
  }
  values.sort((left, right) =>
    compareCodePoints(left.category, right.category) || compareCodePoints(left.stableKey, right.stableKey));
  const identities = new Set<string>();
  for (const value of values) {
    for (const id of [value.citationId, ...(value.citationAlias === undefined ? [] : [value.citationAlias])]) {
      if (identities.has(id)) {
        fail("citation", `Projected citation identity ${id} is ambiguous`);
      }
      identities.add(id);
    }
  }
  return Object.freeze(values);
}

function extension(hint: FoundationProjectionPresentationHint): string {
  switch (hint) {
    case "markdown": return "md";
    case "json": return "json";
    case "diff": return "diff";
    case "source": return "source";
    case "binary": return "bin";
    case "plain-text": return "txt";
  }
}

function slug(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 96);
  return normalized.length === 0 ? "source" : normalized;
}

function materializedSources(values: readonly ProjectedSource[]): readonly MaterializedSource[] {
  return Object.freeze(values.map((value, index) => Object.freeze({
    ...value,
    path: `sources/${String(index + 1).padStart(5, "0")}-${slug(value.citationId)}.${extension(value.presentationHint)}`,
  })));
}

function inline(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function bullet(values: readonly string[], empty = "None."): readonly string[] {
  return values.length === 0 ? [empty] : values.map((value) => `- ${inline(value)}`);
}

function joined(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.map(inline).join(", ");
}

function quotedMarkdown(value: string): readonly string[] {
  return value.replace(/\n$/u, "").split("\n").map((line) => line.length === 0 ? ">" : `> ${line}`);
}

function roleBrief(
  projection: FoundationCompiledProjection,
  operation: ProviderInputV4Operation,
  capability: ProviderInputV4Capability,
  directorDirection: ProviderInputV4DirectorDirection,
  files: readonly MaterializedSource[],
): string {
  const core = projection.manifest.core;
  const projectedPath = (id: string): string | null =>
    files.find((file) => file.citationId === id || file.citationAlias === id)?.path ?? null;
  const assignment = operation === "delivery.prepare"
    ? "Prepare one fresh Work Boundary proposal from the complete Director direction and current projected sources."
    : operation === "delivery.revise"
      ? "Propose one changed Work Boundary that resolves the current mandate condition."
      : operation === "delivery.reaffirm"
        ? "Propose a fresh Work Boundary preserving unchanged mandate semantics only if that mandate remains complete and honest."
        : operation === "delivery.continue"
          ? "Continue bounded reversible work on the current Candidate."
          : "Independently review the exact sealed Candidate against every proposition.";
  const direction = core.class === "orientation"
    ? [
        "## Product Direction",
        "",
        inline(core.objective),
        "",
        `Purpose: ${inline(core.purpose)}`,
        "",
        "### Known Conditions",
        "",
        ...bullet(core.conditions.map((condition) => `${condition.severity}: ${condition.detail}`)),
      ]
    : [
        "## Product Direction",
        "",
        inline(core.objective),
        "",
        `Selected meaning: ${inline(core.selectedMeaning)}`,
        "",
        "### Included",
        "",
        ...bullet(core.included),
        "",
        "### Excluded",
        "",
        ...bullet(core.excluded),
        "",
        "### Assumptions",
        "",
        ...bullet(core.assumptions),
        "",
        "### Falsifiers",
        "",
        ...bullet(core.falsifiers),
        "",
        "### Obligations",
        "",
        ...bullet(core.obligations.map((value) =>
          `${value.id} [${value.kind}]: ${value.statement}; sources: ${joined(value.sourceIds)}; required evidence: ${joined(value.requiredEvidenceIds)}`)),
        "",
        "### Required Artifacts",
        "",
        ...bullet(core.requiredArtifacts.map((value) =>
          `${value.id}: ${value.path}; role: ${value.role}; must change: ${String(value.mustChange)}`)),
        "",
        "### Product Effects",
        "",
        ...bullet(core.effects.map((value) =>
          `${value.id} [${value.kind}]: ${value.summary}; trigger: ${value.trigger}; target: ${value.target}; reversibility: ${value.reversibility}`)),
        "",
        "### Risks",
        "",
        ...bullet(core.risks.map((value) =>
          `${value.id}: ${value.statement}; effects: ${joined(value.effectIds)}; treatment: ${value.treatment}`)),
        "",
        "### Checks",
        "",
        ...bullet(core.checks.map((value) =>
          `${value.id}: ${value.purpose}; Check: ${value.checkId}; bindings: ${joined(value.bindingIds)}; modality: ${value.modality}`)),
        "",
        "### Acceptance Propositions",
        "",
        ...bullet(core.propositions.map((value) =>
          `${value.id}: ${value.claim}; evidence kinds: ${joined(value.evidenceKinds)}; evidence: ${joined(value.evidenceIds)}; obligations: ${joined(value.obligationIds)}; effects: ${joined(value.effectIds)}; risks: ${joined(value.riskIds)}; path: ${value.path ?? "none"}; Check: ${value.checkId ?? "none"}; not-applicable allowed: ${String(value.allowNotApplicable)}; not-applicable condition: ${value.notApplicableCondition ?? "none"}`)),
        "",
        "### Capability Direction",
        "",
        `Profile handle: ${inline(core.capability.profileId)}.`,
        "",
        inline(core.capabilitySummary),
        "",
        "Prohibited effects:",
        "",
        ...bullet(core.prohibitedEffects),
        "",
        "### Completion Rules",
        "",
        ...bullet(core.completionReturnRules),
        "",
        `Material Condition rule: ${inline(core.materialConditionPolicy)}`,
      ];
  const sourceLines = files.length === 0
    ? ["None."]
    : files.flatMap((file) => [
        `- Citation handle: \`${inline(file.citationId)}\``,
        ...(file.knowledgeIdentity === undefined ? [] : [`  Knowledge identity: \`${inline(file.knowledgeIdentity)}\``]),
        ...(file.citationAlias === undefined ? [] : [`  Unambiguous Knowledge alias: \`${inline(file.citationAlias)}\``]),
        `  File: \`${file.path}\``,
        `  Kind: ${file.citationKind}; presentation: ${file.presentationHint}${
          file.useLimit === null ? "" : `; limit: ${inline(file.useLimit)}`
        }`,
      ]);
  const disciplineLines = core.class === "orientation"
    ? [
        "## Discipline Discovery",
        "",
        "Discipline records are optional advisory practice material. Use the work types below to discover useful records, then select exact records with `Selected Knowledge`. `Selected work type` is optional grouping information and does not select every record in a work type.",
        "",
        ...bullet(core.disciplineIndex.workTypes.map((workType) => {
          const records = workType.disciplineIds.map((id) => {
            const path = projectedPath(id);
            return path === null ? id : `${id} (\`${path}\`)`;
          });
          return `${workType.id} — ${workType.title}: ${workType.description}; records: ${records.length === 0 ? "none" : records.join(", ")}`;
        })),
      ]
    : [
        "## Selected Disciplines",
        "",
        "These exact records are advisory support for this work. Apply them with judgment alongside the admitted mandate and your general knowledge; they do not create additional obligations, Checks, Evidence, or authority. Adopted Discipline content and its Registry are maintained outside Delivery and cannot be changed in Candidate work.",
        "",
        `Selected work types: ${joined(core.disciplines.workTypeIds)}.`,
        "",
        ...bullet(core.disciplines.records.map((record) => {
          const path = projectedPath(record.id);
          return `${record.id} — ${record.title}: ${record.summary}; file: ${path === null ? "unavailable" : `\`${path}\``}`;
        })),
      ];
  const effects = capability.externalEffects.length === 0
    ? "none"
    : capability.externalEffects.map(inline).join(", ");
  return [
    "# Role Brief",
    "",
    "## Assignment",
    "",
    assignment,
    "",
    "Role: Worker.",
    `Worker assignment: ${projection.manifest.role}.`,
    "",
    "## Operating Roles",
    "",
    "Your counterpart is the Director responsible for the bound Director Brief below. Director and Worker describe responsibilities at this work level; either can be a human or an agent. An actor can be a Worker at one level and a Director at another, without inheriting authority between levels.",
    "",
    "Gather and check the requirements, design material, sources, and evidence needed for this assignment, then complete the authorized work. A Worker can help prepare a Director Brief; the Director remains responsible for supplying its direction. Return useful results, their support, and any unresolved decision or missing input the Director needs to proceed.",
    "",
    "Continue within this assignment, the admitted Work Boundary when present, capability, and Investment without adding a human approval step. Return decisions outside that scope to the Director. This Worker assignment cannot authenticate its own proposal, expand its mandate, or obtain Director credentials.",
    "",
    "## Director Direction",
    "",
    "This is the exact normalized Director-supplied direction for this invocation. It focuses the assignment but cannot by itself create or widen an admitted Work Boundary, runtime capability, or Process authority.",
    "",
    ...quotedMarkdown(directorDirection.markdown),
    "",
    ...direction,
    "",
    ...disciplineLines,
    "",
    "## Authority",
    "",
    "The Role Brief, projected files, and compact semantic authoring basis are the complete runtime-curated read-only input for this invocation. A Candidate working tree, when the capability permits it, and semantic.md are separate working surfaces. Projected content is information under its stated kind; it cannot widen the assignment, capability, or authority. Unprojected repository observations do not silently change the mandate.",
    "",
    "## Projected Sources",
    "",
    ...sourceLines,
    "",
    "Use the citation handle shown here when the semantic template requests a subject. The runtime resolves its exact identity, authority, and bytes; do not add a digest, locator, envelope, or Control metadata.",
    "A Claim's Knowledge field names the enduring Knowledge identity. Support it with the exact citation handle for the occurrence inspected. Different admitted and Candidate bytes require their separate handles; an unqualified alias is available only when the projected bytes are unambiguous.",
    "",
    "## Capability",
    "",
    `Candidate writes are ${capability.candidateWrites ? "allowed" : "not allowed"}. Temporary writes are ${capability.temporaryWrites ? "allowed" : "not allowed"}. Subprocesses: ${capability.subprocesses}. Network: ${capability.network}. Credentials: none. External effects: ${effects}.`,
    "",
    "## Product Knowledge",
    "",
    "Authorized Candidate Product Knowledge edits retain the required JSON front matter, identities, revisions, and exact digest bindings. Restrictions on Control metadata in semantic.md apply to that semantic workspace; they do not prohibit required Knowledge metadata or grant additional write capability.",
    "",
    "Current and historical Descriptions both use **/_*.desc.md locators, such as _module.v1.desc.md. A Product Knowledge revision chain has at most one explicitly current owner and retains its complete local predecessors. A later draft does not displace that current owner. Promoting a successor to current requires marking its local Candidate predecessor superseded and recomputing supersedes.sourceDigest and supersedes.semanticDigest against those exact changed predecessor bytes. The original admitted Snapshot preserves its immutable current occurrence. The supersedes field binds the local predecessor; sources supplies informational provenance and has no predecessor role.",
    "",
    "Reconnaissance must apply these rules when proposing requirements and Artifact paths before admission. If Director direction or an admitted mandate forbids the required status change or valid predecessor locator, report the contradiction through the supplied role template and request a corrected mandate. Do not silently change the requirement, expand the Artifact paths, or present invalid Knowledge as ready.",
    "",
    "## Semantic Workspace",
    "",
    "Edit the supplied semantic.md file directly. You may inspect and revise that same file across as many provider turns as the invocation permits. Intermediate edits are drafts, not retained records.",
    "",
    FOUNDATION_AGENT_WORK_PRODUCT_LOCAL_HANDLE_GUIDANCE,
    "",
    ...(projection.manifest.role === "reviewer" ? [FOUNDATION_AGENT_WORK_PRODUCT_REVIEW_GUIDANCE, ""] : []),
    "Use the installed lifecycle draft forms command to inspect exact authoring formats. For Product Knowledge, lifecycle draft knowledge WORKSPACE PATH... observes the explicitly selected local records, computes source and semantic digests, and checks their complete selected local revision chains under the workspace public repository contract. Include every local predecessor; this is not complete Candidate Knowledge Set validation.",
    "",
    "Before finishing, run lifecycle draft semantic WORKSPACE PATH --basis \"$LIFECYCLE_PROVIDER_INPUT/semantic-basis.json\" on your governed semantic.md. WORKSPACE is its containing workspace and PATH its relative filename. The fixed read-only basis selects this Attempt's role, installed authoring profiles, citation identities and proposition identities. Correct the draft and repeat within this invocation. Never edit or manufacture the basis. A local result is advisory for those exact bytes and scope; it establishes no currentness, authority, admission, Evidence, or completed submission.",
    "",
    "Before finishing, reread semantic.md against the supplied template and Role Brief. The runtime independently validates the exact final file after the Execution Cell is contained; your terminal message is not a substitute for that file.",
    "",
    "In a Work Boundary proposal, every Obligation Source must name the fixed `mandate` handle or an identity repeated in Selected Knowledge or Selected source. Projection or citation alone does not select a source.",
    "",
    ...(projection.manifest.role === "reconnaissance" ? [
      "A Work Boundary must select at least one baseline-required Check and at least one final-required Check. A postcondition may supply both: set Baseline required and Final required to true. The Runtime records its authorized baseline not-run Receipt without executing the Check, and requires it to pass against the final result. Baseline required does not mean baseline execution for a postcondition.",
      "",
      FOUNDATION_DOCKER_CHECK_ENVIRONMENT_GUIDANCE,
      "",
    ] : []),
    "In semantic.md, keep the exact role template and write only semantic claims, decisions, uncertainty, proposed effects, and role-specific conclusions. Omit unused optional sections, item blocks, and fields rather than retaining template placeholders. Do not add front matter, global identities, digests, ordering claims, references, envelopes, transport objects, SQL, runtime observations, or Process facts to semantic.md. Your terminal message is not the submission and should not repeat the file.",
    "",
  ].join("\n");
}

function content(path: string, bytes: Uint8Array): ProviderInputV4Content {
  if (
    path.startsWith("/") || path.endsWith("/") || path.includes("\\") ||
    path.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) fail("path", "Provider input contains a noncanonical relative path");
  if (bytes.byteLength > MAXIMUM_ENTRY_BYTES) fail("entry-bound", "Provider input entry exceeds its byte bound");
  return Object.freeze({ path, bytes: Uint8Array.from(bytes) });
}

function derive(input: CompileProviderInputV4Options): ProviderInputV4 {
  verifyCompiledProjection(input.projection);
  const role = projectionRole(input.projection);
  if (roleForOperation(input.operation) !== role) {
    fail("role", "Provider input operation and Projection role do not match");
  }
  if (role === "reconnaissance" && input.projection.manifest.class !== "orientation") {
    fail("projection", "Reconnaissance provider input requires one Orientation Projection");
  }
  if (role !== "reconnaissance" && input.projection.manifest.class !== "execution") {
    fail("projection", "Productive or review provider input requires one Execution Projection");
  }
  const capability = normalizedCapability(input.capability);
  if (role !== "builder" && capability.candidateWrites) {
    fail("capability", "Reconnaissance and review cannot receive Candidate write capability");
  }
  const roleSubjectDigest = exactDigest(input.roleSubjectDigest, "Role-subject digest");
  const rootTokenSetDigest = exactDigest(input.rootTokenSetDigest, "Root-token-set digest");
  const directorDirection = normalizedDirectorDirection(input.directorSemanticMarkdown);
  const semanticTemplate = renderAgentWorkProductTemplate(role);
  const projected = materializedSources(sources(input.projection));
  const briefMarkdown = roleBrief(
    input.projection,
    input.operation,
    capability,
    directorDirection,
    projected,
  );
  const retainedRoleBrief: ProviderInputV4RoleBrief = Object.freeze({
    markdown: briefMarkdown,
    digest: sha256Bytes(briefMarkdown),
  });
  const citationRegistry = Object.freeze(projected.flatMap((value) =>
    [value.citationId, ...(value.citationAlias === undefined ? [] : [value.citationAlias])].map((id) => Object.freeze({
      id,
      kind: value.citationKind,
      knowledgeIdentity: value.knowledgeIdentity ?? null,
      digest: value.citationDigest,
      locator: value.path,
      authorityClass: value.authorityClass,
    }))).sort((left, right) => compareCodePoints(left.id, right.id)));
  const citationRegistryDigest = digestCanonical(Object.freeze({
    schema: "lifecycle.attempt-citation-registry.v3",
    items: citationRegistry,
  }));
  const propositionSet = input.propositionSet ?? null;
  if (role === "reviewer" && propositionSet === null) {
    fail("proposition-set", "Reviewer input requires its complete exact proposition set");
  }
  const propositionSetDigest = propositionSet === null ? null : digestCanonical({
    schema: propositionSet.schema,
    propositions: [...propositionSet.propositions].sort((left, right) => compareCodePoints(left.id, right.id)),
  });
  if (role !== "reviewer" && propositionSet !== null) {
    fail("proposition-set", "Only reviewer input may select a proposition set");
  }
  const validationBasis = createAgentWorkProductValidationBasis({
    role,
    templateDigest: semanticTemplate.digest,
    parserProfileId: FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
    parserProfileDigest: agentWorkProductParserProfileDigest(),
    compilerProfileId: FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
    compilerProfileDigest: agentWorkProductCompilerProfileDigest(),
    citationRegistry,
    citationRegistryDigest,
    propositionSet,
    propositionSetDigest,
  });
  const basisBytes = Buffer.from(canonicalJson(validationBasis), "utf8");
  if (basisBytes.byteLength > PROVIDER_INPUT_SEMANTIC_BASIS_MAXIMUM_BYTES) {
    fail("semantic-basis-bound", "Semantic authoring basis exceeds its exact byte bound");
  }
  const contents = Object.freeze([
    content("role-brief.md", Buffer.from(briefMarkdown, "utf8")),
    content(PROVIDER_INPUT_SEMANTIC_BASIS_PATH, basisBytes),
    ...projected.map((value) => content(value.path, value.bytes)),
  ].sort((left, right) => compareCodePoints(left.path, right.path)));
  if (contents.length === 0 || contents.length > MAXIMUM_ENTRIES) {
    fail("entry-count", "Provider input must have one bounded nonempty file inventory");
  }
  let totalBytes = 0;
  const inventoryEntries = Object.freeze(contents.map((value, index) => {
    if (index > 0 && contents[index - 1]!.path === value.path) fail("path", "Provider input repeats a file path");
    totalBytes += value.bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAXIMUM_TOTAL_BYTES) {
      fail("total-bound", "Provider input exceeds its complete byte bound");
    }
    return Object.freeze({
      path: value.path,
      byteLength: value.bytes.byteLength,
      digest: sha256Bytes(value.bytes),
    });
  }));
  const inventory = Object.freeze({
    schema: PROVIDER_INPUT_V4_INVENTORY_SCHEMA,
    entries: inventoryEntries,
  });
  const contentInventoryDigest = digestCanonical(inventory);
  const inputMaterial = Object.freeze({
    schema: PROVIDER_INPUT_V4_MATERIAL_SCHEMA,
    layoutProfileId: PROVIDER_INPUT_V4_LAYOUT,
    projectionDigest: input.projection.manifest.digest,
    roleSubjectDigest,
    directorDirectionDigest: directorDirection.digest,
    roleBriefDigest: retainedRoleBrief.digest,
    semanticTemplateDigest: semanticTemplate.digest,
    validationBasisDigest: validationBasis.digest,
    contentInventoryDigest,
    rootTokenSetDigest,
  });
  const inputMaterialDigest = digestCanonical(inputMaterial);
  const manifest = Object.freeze({
    schema: PROVIDER_INPUT_V4_MANIFEST_SCHEMA,
    layoutProfileId: PROVIDER_INPUT_V4_LAYOUT,
    inputMaterialDigest,
    contentInventoryDigest,
    rootTokenSetDigest,
    entries: inventoryEntries,
    entryCount: inventoryEntries.length,
    totalBytes,
  });
  const manifestDigest = digestCanonical(manifest);
  const tree = Object.freeze({
    schema: PROVIDER_INPUT_V4_TREE_SCHEMA,
    layoutProfileId: PROVIDER_INPUT_V4_LAYOUT,
    manifestDigest,
    entries: inventoryEntries,
  });
  return Object.freeze({
    role,
    operation: input.operation,
    projectionDigest: input.projection.manifest.digest,
    roleSubjectDigest,
    rootTokenSetDigest,
    capability,
    directorDirection,
    roleBrief: retainedRoleBrief,
    semanticTemplate,
    citationRegistry,
    citationRegistryDigest,
    propositionSet,
    validationBasis,
    contents,
    inventory,
    contentInventoryDigest,
    inputMaterial,
    inputMaterialDigest,
    manifestDigest,
    bundleDigest: digestCanonical(tree),
  });
}

function comparable(value: ProviderInputV4): unknown {
  return Object.freeze({
    ...value,
    contents: value.contents.map((entry) => Object.freeze({
      path: entry.path,
      byteLength: entry.bytes.byteLength,
      digest: sha256Bytes(entry.bytes),
    })),
  });
}

/** Exact binary-aware comparison used when reopening retained Agent input. */
export function sameProviderInputV4(left: ProviderInputV4, right: ProviderInputV4): boolean {
  return digestCanonical(comparable(left)) === digestCanonical(comparable(right));
}

export function verifyProviderInputV4(
  value: ProviderInputV4,
  projection: FoundationCompiledProjection,
): void {
  const expected = derive({
    projection,
    operation: value.operation,
    roleSubjectDigest: value.roleSubjectDigest,
    rootTokenSetDigest: value.rootTokenSetDigest,
    capability: value.capability,
    directorSemanticMarkdown: value.directorDirection.markdown,
    propositionSet: value.propositionSet,
  });
  if (!sameProviderInputV4(value, expected)) {
    fail("verification", "Provider input no longer reproduces its exact Projection and runtime bindings");
  }
}

/**
 * Compile the complete provider-visible read-only input without exposing the
 * Projection manifest or Control records. The compact authoring basis exposes
 * only its selected identity/digest facts, not full retained subjects or locators.
 * The returned typed values remain runtime custody; only `contents` are files.
 */
export function compileProviderInputV4(input: CompileProviderInputV4Options): ProviderInputV4 {
  const result = derive(input);
  verifyProviderInputV4(result, input.projection);
  return result;
}
