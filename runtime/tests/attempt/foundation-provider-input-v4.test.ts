import assert from "node:assert/strict";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import { FOUNDATION_DOCKER_CHECK_ENVIRONMENT_GUIDANCE } from "../../src/foundation/check/environment-requirements.js";
import { knowledgeOccurrenceItemId } from "../../src/foundation/knowledge/identity.js";
import {
  agentWorkProductCompilerProfileDigest,
  agentWorkProductParserProfileDigest,
  createAgentWorkProductValidationBasis,
  FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
  FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
  FOUNDATION_AGENT_WORK_PRODUCT_REVIEW_GUIDANCE,
  renderAgentWorkProductTemplate,
  validateAgentWorkProductSemanticMarkdown,
} from "../../src/foundation/control/agent-work-product-semantics.js";
import {
  compileProviderInputV4,
  PROVIDER_INPUT_V4_LAYOUT,
  PROVIDER_INPUT_V4_MANIFEST_SCHEMA,
  PROVIDER_INPUT_V4_TREE_SCHEMA,
  sameProviderInputV4,
  verifyProviderInputV4,
  type ProviderInputV4,
} from "../../src/foundation/attempt/provider-input-v4.js";
import {
  buildMandatoryItem,
  ProjectionByteInventoryBuilder,
} from "../../src/foundation/projection/content.js";
import type {
  FoundationCompiledProjection,
  FoundationKnowledgeProjection,
  FoundationOrientationProjectionCore,
  FoundationProjectionCacheKey,
} from "../../src/foundation/projection/types.js";
import { FOUNDATION_PROJECTION_REACHABLE_CATEGORIES } from "../../src/foundation/projection/orientation.js";
import { verifyCompiledProjection } from "../../src/foundation/projection/verification.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { compareCodePoints } from "../../src/foundation/validation/ordering.js";
import {
  foundationAttemptProjectionFixture,
  type FoundationAttemptProjectionBuilderSubject,
  type FoundationAttemptProjectionOrientationSubject,
} from "../helpers/foundation-attempt-projection-fixture.js";
import { evidenceFixtureV7 } from "../helpers/evidence-fixture-v7.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";

function digest(value: string): Sha256 {
  return sha256Bytes(`provider-input-v4:${value}`);
}

function signed<const Value extends Readonly<Record<string, unknown>>>(
  value: Value,
): Value & Readonly<{ digest: Sha256 }> {
  return Object.freeze({ ...value, digest: selfDigest(value as Record<string, unknown>) });
}

function orientationSubject(): FoundationAttemptProjectionOrientationSubject {
  const objective = "Prepare one exact provider-input v4 seam.";
  const base = {
    kind: "orientation" as const,
    objective,
    objectiveDigest: sha256Bytes(objective),
    atlasStateDigest: digest("atlas"),
    knowledgeObservationDigest: digest("knowledge-observation"),
    knowledgeSetDigest: null,
  };
  return Object.freeze({ ...base, digest: selfDigest(base) });
}

function builderSubject(): FoundationAttemptProjectionBuilderSubject {
  const base = {
    kind: "builder" as const,
    boundary: Object.freeze({
      id: "boundary.provider-input-v4",
      revision: 1,
      digest: digest("boundary"),
    }),
    candidate: Object.freeze({
      baseCommit: "d".repeat(40),
      revision: Object.freeze({
        kind: "candidate-revision" as const,
        id: "candidate.provider-input-v4",
        revision: 1,
        digest: digest("candidate-revision"),
      }),
      currentDigest: digest("candidate"),
      carrierManifestDigest: digest("candidate-carrier-manifest"),
      sealedTree: null,
      sealDigest: null,
      diffDigest: null,
    }),
    evidence: Object.freeze({ items: Object.freeze([{ id: "evidence.provider-input-v4" }]) }),
  };
  return Object.freeze({ ...base, digest: selfDigest(base) });
}

function projectionWithExactSources(): Readonly<{
  projection: FoundationCompiledProjection;
  knowledgeBytes: Buffer;
  reachableBytes: Buffer;
}> {
  const subject = orientationSubject();
  const base = foundationAttemptProjectionFixture(subject);
  const knowledgeBytes = Buffer.from("# Provider input behavior\n\nThe Agent receives exact projected bytes.\n", "utf8");
  const reachableBytes = Buffer.from("# Related Knowledge\n\nThis exact mounted neighboring record remains nonauthoritative.\n", "utf8");
  const knowledgeContent = Object.freeze({
    mode: "inline" as const,
    mediaType: "text/markdown",
    encoding: "utf-8" as const,
    text: knowledgeBytes.toString("utf8"),
    byteLength: knowledgeBytes.byteLength,
    digest: sha256Bytes(knowledgeBytes),
  });
  const mandatory = buildMandatoryItem({
    id: "projection-item.behavior.provider-input",
    category: "knowledge",
    sourceIdentity: "behavior.provider-input",
    kind: "behavior",
    authority: "product-knowledge",
    locator: "records/behavior/provider-input.md",
    revision: 1,
    sourceDigest: sha256Bytes(knowledgeBytes),
    semanticDigest: digest("knowledge-semantics"),
    inclusionReasons: ["selected for provider-input verification"],
    relationshipPaths: [["behavior.provider-input"]],
    content: knowledgeContent,
    presentationHint: "markdown",
    useLimit: null,
  });
  const inventory = new ProjectionByteInventoryBuilder();
  const mounted = inventory.add({
    tier: "reachable",
    key: "reachable.knowledge.provider-input",
    bytes: reachableBytes,
    mediaType: "text/markdown",
    encoding: "utf-8",
  });
  const reachable = Object.freeze({
    handle: "reachable.knowledge.provider-input",
    id: "behavior.related-provider-input",
    category: "related-knowledge" as const,
    kind: "behavior",
    summary: "Exact neighboring Knowledge record.",
    sourceRevision: "1",
    digest: mounted.digest,
    byteLength: mounted.byteLength,
    retrieval: "mounted" as const,
    mountedPath: mounted.path,
  });

  const baseCore = base.manifest.core as FoundationOrientationProjectionCore;
  const retrievalIndex = signed({
    entries: Object.freeze([Object.freeze({
      handle: reachable.handle,
      id: reachable.id,
      kind: reachable.kind,
      digest: reachable.digest,
      byteLength: reachable.byteLength,
      availability: reachable.retrieval,
    })]),
  });
  const core: FoundationOrientationProjectionCore = Object.freeze({
    ...baseCore,
    retrievalIndex,
    indexDigest: digestCanonical({
      knowledgeIndexDigest: baseCore.knowledgeIndex.digest,
      disciplineIndexDigest: baseCore.disciplineIndex.digest,
      coverageIndexDigest: baseCore.coverageIndex.digest,
      bindingIndexDigest: baseCore.bindingIndex.digest,
      capabilityIndexDigest: baseCore.capabilityIndex.digest,
      profileIndexDigest: baseCore.profileIndex.digest,
      retrievalIndexDigest: retrievalIndex.digest,
    }),
  });
  const zero = Object.freeze({ items: 0, bytes: 0 });
  const omission = Object.freeze({
    ...base.manifest.omission,
    categories: Object.freeze(FOUNDATION_PROJECTION_REACHABLE_CATEGORIES.map((category) => {
      const represented = category === "related-knowledge"
        ? Object.freeze({ items: 1, bytes: reachable.byteLength })
        : zero;
      return Object.freeze({
        category,
        before: represented,
        after: represented,
        omitted: zero,
        omittedIds: Object.freeze([] as string[]),
        enumerationComplete: true as const,
      });
    })),
  });
  const coreBytes = Buffer.byteLength(canonicalJson(core), "utf8");
  const { digest: _oldManifestDigest, ...baseManifest } = base.manifest;
  const manifestSubject = {
    ...baseManifest,
    core,
    mandatory: Object.freeze([mandatory]),
    reachable: Object.freeze([reachable]),
    omission,
    counts: Object.freeze({
      coreBytes,
      atlas: base.manifest.counts.atlas,
      mandatory: Object.freeze({ items: 1, bytes: knowledgeBytes.byteLength }),
      implementation: zero,
      bindings: zero,
      sources: zero,
      reachable: Object.freeze({ items: 1, bytes: reachableBytes.byteLength }),
      conflicts: 0,
      unresolved: 0,
      totalBytes: coreBytes + base.manifest.counts.atlas.bytes + knowledgeBytes.byteLength + reachableBytes.byteLength,
    }),
  };
  const manifest = Object.freeze({
    ...manifestSubject,
    digest: selfDigest(manifestSubject as unknown as Record<string, unknown>),
  }) as FoundationKnowledgeProjection;
  const cacheSubject = (({ digest: _cacheDigest, ...value }) => value)(base.cacheKey);
  const cacheKey = Object.freeze({
    ...cacheSubject,
    digest: digestCanonical(cacheSubject),
  }) as FoundationProjectionCacheKey;
  const projection: FoundationCompiledProjection = Object.freeze({
    manifest,
    inventory: inventory.entries(),
    cacheKey,
  });
  verifyCompiledProjection(projection);
  return Object.freeze({ projection, knowledgeBytes, reachableBytes });
}

function compile(
  directorSemanticMarkdown = "# Director request\n\nInspect the exact projected inputs.\n",
): Readonly<{
  projection: FoundationCompiledProjection;
  providerInput: ProviderInputV4;
  knowledgeBytes: Buffer;
  reachableBytes: Buffer;
}> {
  const fixture = projectionWithExactSources();
  const providerInput = compileProviderInputV4({
    projection: fixture.projection,
    operation: "delivery.prepare",
    roleSubjectDigest: digest("role-subject"),
    rootTokenSetDigest: digest("root-token-set"),
    capability: {
      candidateWrites: false,
      temporaryWrites: true,
      subprocesses: "none",
      network: "none",
      credentials: "none",
      externalEffects: [],
    },
    directorSemanticMarkdown,
  });
  return Object.freeze({ ...fixture, providerInput });
}

function projectionWithKnowledgeOccurrences(
  change: "revision" | "line-endings" | "none",
  metadataMutation: "revision" | "semantic-digest" | null = null,
): FoundationCompiledProjection {
  const source = projectionWithExactSources().projection;
  const original = source.manifest.mandatory[0]!;
  const { itemDigest: _itemDigest, ...originalSubject } = original;
  const originalBytes = original.content.mode === "inline" ? original.content.text : assert.fail("Expected inline fixture");
  const candidateText = change === "revision"
    ? `${originalBytes}The proposed revision expands the observable result.\n`
    : change === "line-endings" ? originalBytes.replace(/\n/gu, "\r\n") : originalBytes;
  const candidateIdentity = {
    basis: "candidate" as const,
    id: original.sourceIdentity,
    revision: change === "revision" || metadataMutation === "revision" ? 2 : 1,
    sourceDigest: sha256Bytes(candidateText),
    semanticDigest: change === "revision" || metadataMutation === "semantic-digest" ? digest("revised-knowledge-semantics") : original.semanticDigest!,
  };
  const duplicate = buildMandatoryItem({
    ...originalSubject,
    id: knowledgeOccurrenceItemId(candidateIdentity),
    revision: candidateIdentity.revision,
    sourceDigest: candidateIdentity.sourceDigest,
    semanticDigest: candidateIdentity.semanticDigest,
    content: Object.freeze({
      ...original.content,
      mode: "inline" as const,
      encoding: "utf-8" as const,
      text: candidateText,
      byteLength: Buffer.byteLength(candidateText),
      digest: candidateIdentity.sourceDigest,
    }),
  });
  const mandatory = Object.freeze([original, duplicate].sort((left, right) =>
    Number(left.revision) - Number(right.revision) || compareCodePoints(left.id, right.id)));
  const counts = Object.freeze({
    ...source.manifest.counts,
    mandatory: Object.freeze({
      items: 2,
      bytes: original.content.byteLength + duplicate.content.byteLength,
    }),
    totalBytes: source.manifest.counts.totalBytes + duplicate.content.byteLength,
  });
  const { digest: _manifestDigest, ...manifestSubject } = source.manifest;
  const manifest = Object.freeze({
    ...manifestSubject,
    mandatory,
    counts,
    digest: selfDigest({
      ...manifestSubject,
      mandatory,
      counts,
    } as unknown as Record<string, unknown>),
  }) as FoundationKnowledgeProjection;
  const projection = Object.freeze({
    ...source,
    manifest,
  });
  verifyCompiledProjection(projection);
  return projection;
}

function assertProductKnowledgeGuidance(brief: string): void {
  assert.match(brief, /Authorized Candidate Product Knowledge edits retain the required JSON front matter/u);
  assert.match(brief, /Current and historical Descriptions both use \*\*\/_\*\.desc\.md locators/u);
  assert.match(brief, /A later draft does not displace that current owner/u);
  assert.match(brief, /marking its local Candidate predecessor superseded and recomputing supersedes\.sourceDigest and supersedes\.semanticDigest/u);
  assert.match(brief, /original admitted Snapshot preserves its immutable current occurrence/u);
  assert.match(brief, /sources supplies informational provenance and has no predecessor role/u);
  assert.match(brief, /Reconnaissance must apply these rules when proposing requirements and Artifact paths before admission/u);
  assert.match(brief, /If Director direction or an admitted mandate forbids the required status change or valid predecessor locator, report the contradiction/u);
  assert.match(brief, /Do not add front matter, .* or Process facts to semantic\.md\./u);
}

function assertOperatingRoles(brief: string, assignment: "reconnaissance" | "builder" | "reviewer"): void {
  assert.match(brief, /Role: Worker\./u);
  assert(brief.includes(`Worker assignment: ${assignment}.`));
  assert.match(brief, /counterpart is the Director responsible for the bound Director Brief/u);
  assert.match(brief, /either can be a human or an agent/u);
  assert.match(brief, /without inheriting authority between levels/u);
  assert.match(brief, /requirements, design material, sources, and evidence/u);
  assert.match(brief, /Director remains responsible for supplying its direction/u);
  assert.match(brief, /without adding a human approval step/u);
  assert.match(brief, /cannot authenticate its own proposal, expand its mandate, or obtain Director credentials/u);
}

test("provider input v4 renders readable briefing, exact sources and one immutable compact semantic basis", () => {
  const first = compile();
  const second = compile();
  verifyProviderInputV4(first.providerInput, first.projection);
  assert.equal(first.providerInput.inputMaterial.layoutProfileId, PROVIDER_INPUT_V4_LAYOUT);
  assert.equal(PROVIDER_INPUT_V4_LAYOUT, "lifecycle.agent-provider-input.standard-v8");
  assert.equal(first.providerInput.inventory.schema, "lifecycle.agent-input-content-inventory.v8");
  assert.equal(first.providerInput.inputMaterial.schema, "lifecycle.agent-input-material.v8");
  assert.equal(PROVIDER_INPUT_V4_MANIFEST_SCHEMA, "lifecycle.agent-input-bundle-manifest.v8");
  assert.equal(PROVIDER_INPUT_V4_TREE_SCHEMA, "lifecycle.agent-input-bundle-tree.v8");
  assert.equal(first.providerInput.inputMaterialDigest, second.providerInput.inputMaterialDigest);
  assert.equal(first.providerInput.bundleDigest, second.providerInput.bundleDigest);
  assert.deepEqual(first.providerInput.contents.map(({ path }) => path), [
    "role-brief.md",
    "semantic-basis.json",
    "sources/00001-atlas-target-atlas-target.json",
    "sources/00002-projection-item.behavior.provider-input.md",
    "sources/00003-behavior.related-provider-input.txt",
  ]);
  const basisContent = first.providerInput.contents.find(({ path }) => path === "semantic-basis.json")!;
  assert.deepEqual(JSON.parse(Buffer.from(basisContent.bytes).toString("utf8")), first.providerInput.validationBasis);
  assert.equal(first.providerInput.inputMaterial.validationBasisDigest, first.providerInput.validationBasis.digest);
  assert.doesNotMatch(Buffer.from(basisContent.bytes).toString("utf8"), /locator|authorityClass|private:\/\//u);
  assert.throws(() => verifyProviderInputV4({ ...first.providerInput, validationBasis: { ...first.providerInput.validationBasis, digest: digest("substituted-basis") } }, first.projection));
  const brief = first.providerInput.roleBrief.markdown;
  assertOperatingRoles(brief, "reconnaissance");
  assertProductKnowledgeGuidance(brief);
  assert.match(brief, /lifecycle draft semantic WORKSPACE PATH --basis/u);
  assert.match(brief, /^# Role Brief\n/u);
  assert.match(brief, /## Director Direction\n\n.*\n\n> # Director request\n>\n> Inspect the exact projected inputs\./u);
  assert.match(brief, /Edit the supplied semantic\.md file directly/u);
  assert.match(brief, /unique across the whole semantic\.md, including different sections and item kinds/u);
  assert.match(brief, /Objective and Mandate define the fixed handles objective and mandate/u);
  assert.match(brief, /repeating a reference is different from defining that handle again/u);
  assert.match(brief, /runtime independently validates the exact final file/u);
  assert.match(brief, /Obligation Source must name the fixed `mandate` handle or an identity repeated in Selected Knowledge or Selected source/u);
  assert.doesNotMatch(brief, /another local proposal handle/u);
  assert.match(brief, /Projection or citation alone does not select a source/u);
  assert.match(brief, /at least one baseline-required Check and at least one final-required Check/u);
  assert.match(brief, /authorized baseline not-run Receipt without executing the Check/u);
  assert.match(brief, /Baseline required does not mean baseline execution for a postcondition/u);
  assert(brief.includes(FOUNDATION_DOCKER_CHECK_ENVIRONMENT_GUIDANCE));
  assert.match(brief, /returns unsupported before allocation for every nonempty Environment requirement/u);
  assert.match(brief, /omit it only when no additional proof precondition is intended/u);
  assert.match(brief, /Binding already declares its executable, arguments, working directory, environment, network selection and timeout/u);
  assert.match(brief, /baseline postcondition not-run Receipt does not establish final execution support/u);
  assert.match(brief, /Do not silently remove or reinterpret an authored requirement/u);
  assert.match(brief, /Semantic draft validity does not establish Check execution feasibility/u);
  assert.doesNotMatch(brief, /^---$/mu);
  assert.doesNotMatch(brief, /sha256:|projection:|Attempt:|Invocation:|front matter bytes/u);
  assert.doesNotMatch(brief, /manifest\.json|subject\.json|attempt\.md/u);
  assert.equal(first.providerInput.contents.some(({ path }) => path.endsWith("template.md")), false);
  const atlasContent = first.projection.manifest.atlas[0]!.content;
  assert.equal(atlasContent.mode, "inline");
  if (atlasContent.mode !== "inline") assert.fail("Atlas fixture content is not inline");
  assert.deepEqual(
    Buffer.from(first.providerInput.contents[2]!.bytes),
    Buffer.from(atlasContent.text, "utf8"),
  );
  assert.deepEqual(
    Buffer.from(first.providerInput.contents[3]!.bytes),
    first.knowledgeBytes,
  );
  assert.deepEqual(
    Buffer.from(first.providerInput.contents[4]!.bytes),
    first.reachableBytes,
  );
  assert.deepEqual(first.providerInput.citationRegistry.map(({ id, locator }) => ({ id, locator })), [
    { id: "atlas:target:atlas:target:-:-", locator: "sources/00001-atlas-target-atlas-target.json" },
    { id: "behavior.provider-input", locator: "sources/00002-projection-item.behavior.provider-input.md" },
    { id: "behavior.related-provider-input", locator: "sources/00003-behavior.related-provider-input.txt" },
    { id: "projection-item.behavior.provider-input", locator: "sources/00002-projection-item.behavior.provider-input.md" },
  ]);
  assert.equal(first.providerInput.citationRegistry[0]?.authorityClass, "repository-authored");
  assert.equal(first.providerInput.citationRegistry[0]?.digest, first.projection.manifest.atlas[0]?.normalizedDigest);
});

test("provider input v4 binds normalized Director direction through every provider-input identity", () => {
  const first = compile();
  const changed = compile("# Director request\n\nInspect only the exact Candidate surface.\n");
  assert.equal(
    first.providerInput.directorDirection.markdown,
    "# Director request\n\nInspect the exact projected inputs.\n",
  );
  assert.equal(
    first.providerInput.directorDirection.digest,
    sha256Bytes(first.providerInput.directorDirection.markdown),
  );
  assert.equal(
    first.providerInput.directorDirection.byteLength,
    Buffer.byteLength(first.providerInput.directorDirection.markdown, "utf8"),
  );
  assert.equal(
    first.providerInput.inputMaterial.directorDirectionDigest,
    first.providerInput.directorDirection.digest,
  );
  assert.notEqual(first.providerInput.directorDirection.digest, changed.providerInput.directorDirection.digest);
  assert.notEqual(first.providerInput.roleBrief.digest, changed.providerInput.roleBrief.digest);
  assert.notEqual(first.providerInput.inputMaterialDigest, changed.providerInput.inputMaterialDigest);
  assert.notEqual(first.providerInput.manifestDigest, changed.providerInput.manifestDigest);
  assert.notEqual(first.providerInput.bundleDigest, changed.providerInput.bundleDigest);

  const tampered = Object.freeze({
    ...first.providerInput,
    directorDirection: Object.freeze({
      ...first.providerInput.directorDirection,
      markdown: "# Director request\n\nTampered direction.\n",
    }),
  });
  assert.throws(() => verifyProviderInputV4(tampered, first.projection), (error: unknown) =>
    error instanceof FoundationError &&
    error.code === "lifecycle.attempt.provider-input-v4.verification");
});

test("provider input v4 exact identity is binary-aware without canonicalizing typed arrays", () => {
  const first = compile();
  const second = compile();
  assert.equal(
    sameProviderInputV4(first.providerInput, second.providerInput),
    true,
  );
  const original = first.providerInput.contents[0];
  assert.ok(original);
  const substitutedBytes = Uint8Array.from(original.bytes);
  substitutedBytes[0] = substitutedBytes[0]! === 0 ? 1 : substitutedBytes[0]! - 1;
  const substituted = Object.freeze({
    ...first.providerInput,
    contents: Object.freeze([Object.freeze({
      ...original,
      bytes: substitutedBytes,
    }), ...first.providerInput.contents.slice(1)]),
  });
  assert.equal(
    sameProviderInputV4(first.providerInput, substituted),
    false,
  );
});

test("provider input v4 renders the complete execution mandate without operational mechanics", () => {
  const projection = foundationAttemptProjectionFixture(builderSubject());
  const providerInput = compileProviderInputV4({
    projection,
    operation: "delivery.continue",
    roleSubjectDigest: digest("builder-role-subject"),
    rootTokenSetDigest: digest("builder-root-token-set"),
    capability: {
      candidateWrites: true,
      temporaryWrites: true,
      subprocesses: "repository-toolchain",
      network: "none",
      credentials: "none",
      externalEffects: [],
    },
    directorSemanticMarkdown: "Continue implementation against the current Candidate.\n",
  });
  const brief = providerInput.roleBrief.markdown;
  assertOperatingRoles(brief, "builder");
  assertProductKnowledgeGuidance(brief);
  assert.match(brief, /### Assumptions/u);
  assert.match(brief, /### Falsifiers/u);
  assert.match(brief, /obligation\.fixture\.builder \[acceptance\]/u);
  assert.match(brief, /proposition\.fixture\.builder: .*evidence: evidence\.provider-input-v4/u);
  assert.match(brief, /not-applicable allowed: false/u);
  assert.match(brief, /### Capability Direction/u);
  assert.match(brief, /Prohibited effects:/u);
  assert.match(brief, /Material Condition rule:/u);
  assert.doesNotMatch(brief, /A postcondition may supply both/u);
  assert(!brief.includes(FOUNDATION_DOCKER_CHECK_ENVIRONMENT_GUIDANCE), "Builder guidance does not invite Check mandate editing");
  assert(!brief.includes(FOUNDATION_AGENT_WORK_PRODUCT_REVIEW_GUIDANCE));
  assert.doesNotMatch(brief, /sha256:|front matter bytes|Attempt:|Invocation:/u);
  assert.deepEqual(providerInput.contents.map(({ path }) => path), [
    "role-brief.md",
    "semantic-basis.json",
    "sources/00001-atlas-target-atlas-target.json",
  ]);
});

test("reviewer Role Brief explains typed mandate resolution and exact citation responsibilities", () => {
  const fixture = evidenceFixtureV7();
  const selected = fixture.selected;
  const candidate = fixture.store.getRevision(selected.candidate.id, selected.candidate.revision)!;
  const seal = fixture.store.getRevision(selected.seal.id, selected.seal.revision)!;
  const state = candidate.payload.state as ControlJsonObject;
  const propositionSet = { schema: "lifecycle.proposition-set.v3" as const,
    propositions: [{ id: "proposition.fixture.reviewer", claim: "The exact fixture Projection basis and core are preserved." }] };
  const subject = signed({
    kind: "reviewer" as const,
    boundary: selected.boundary,
    candidate: { baseCommit: candidate.payload.candidateBaseCommit as string,
      currentDigest: state.candidateDigest as Sha256, sealedTree: state.tree as string,
      sealDigest: seal.digest, diffDigest: state.diffDigest as Sha256 },
    evidence: { items: [] },
    propositionSetDigest: digestCanonical(propositionSet),
  });
  const projection = foundationAttemptProjectionFixture(subject, { reviewerCandidate: candidate, reviewerSeal: seal });
  const providerInput = compileProviderInputV4({
    projection, operation: "delivery.evaluate", roleSubjectDigest: digest("review-role-subject"),
    rootTokenSetDigest: digest("review-root-token-set"), propositionSet,
    capability: { candidateWrites: false, temporaryWrites: true, subprocesses: "none", network: "none", credentials: "none", externalEffects: [] },
    directorSemanticMarkdown: "Review the exact result and identify any required mandate correction.\n",
  });
  verifyProviderInputV4(providerInput, projection);
  const brief = providerInput.roleBrief.markdown;
  assertOperatingRoles(brief, "reviewer");
  assert(brief.includes(FOUNDATION_AGENT_WORK_PRODUCT_REVIEW_GUIDANCE));
  assert.match(brief, /requires-readmission requires exactly one Material Condition block/u);
  assert.match(brief, /including an authorized not-run Receipt/u);
  assert.match(brief, /must cite its own exact original Receipt/u);
  assert.match(brief, /Subject uses the supplied frozen citation handle and Supports names at least one Claim local handle/u);
  assert.match(brief, /Review is read-only: propose the Condition/u);
  assert(!brief.includes(FOUNDATION_DOCKER_CHECK_ENVIRONMENT_GUIDANCE));
  assert.equal(providerInput.roleBrief.digest, sha256Bytes(brief));
});

test("provider input v4 refuses role or capability widening during compilation", () => {
  const fixture = projectionWithExactSources();
  const common = {
    projection: fixture.projection,
    roleSubjectDigest: digest("role-subject"),
    rootTokenSetDigest: digest("root-token-set"),
    directorSemanticMarkdown: "Prepare one bounded proposal.\n",
    capability: {
      candidateWrites: false,
      temporaryWrites: true,
      subprocesses: "none" as const,
      network: "none" as const,
      credentials: "none" as const,
      externalEffects: Object.freeze([] as string[]),
    },
  };
  assert.throws(() => compileProviderInputV4({
    ...common,
    operation: "delivery.continue",
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.attempt.provider-input-v4.role");
  assert.throws(() => compileProviderInputV4({
    ...common,
    operation: "delivery.prepare",
    capability: { ...common.capability, candidateWrites: true },
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.attempt.provider-input-v4.capability");
});

for (const change of ["revision", "line-endings", "none"] as const) {
test(`provider input v4 preserves Knowledge occurrences and resolves exact citations: ${change}`, () => {
  const projection = projectionWithKnowledgeOccurrences(change);
  const providerInput = compileProviderInputV4({
    projection,
    operation: "delivery.prepare",
    roleSubjectDigest: digest("role-subject"),
    rootTokenSetDigest: digest("root-token-set"),
    capability: {
      candidateWrites: false,
      temporaryWrites: true,
      subprocesses: "none",
      network: "none",
      credentials: "none",
      externalEffects: [],
    },
    directorSemanticMarkdown: "Prepare one bounded proposal.\n",
  });
  verifyProviderInputV4(providerInput, projection);
  const registry = providerInput.citationRegistry;
  const occurrences = projection.manifest.mandatory;
  assert.equal(occurrences.length, 2);
  assert.notEqual(occurrences[0]!.id, occurrences[1]!.id);
  for (const occurrence of occurrences) {
    const citation = registry.find(({ id }) => id === occurrence.id)!;
    assert.equal(citation.kind, "knowledge");
    assert.equal(citation.knowledgeIdentity, occurrence.sourceIdentity);
    assert.equal(citation.digest, occurrence.sourceDigest);
    assert.equal(citation.authorityClass, "repository-authored");
    const bytes = providerInput.contents.find(({ path }) => path === citation.locator)!.bytes;
    assert.equal(sha256Bytes(bytes), occurrence.sourceDigest);
  }
  const aliases = registry.filter(({ id }) => id === "behavior.provider-input");
  assert.equal(aliases.length, change === "none" ? 1 : 0);
  if (change === "line-endings") {
    assert.equal(occurrences[0]!.semanticDigest, occurrences[1]!.semanticDigest);
    assert.notEqual(occurrences[0]!.sourceDigest, occurrences[1]!.sourceDigest);
  }
  if (change === "none") {
    assert.equal(occurrences[0]!.sourceDigest, occurrences[1]!.sourceDigest);
    assert.equal(aliases[0]!.digest, occurrences[0]!.sourceDigest);
  }
  const basis = createAgentWorkProductValidationBasis({
    role: "builder",
    templateDigest: renderAgentWorkProductTemplate("builder").digest,
    parserProfileId: FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
    parserProfileDigest: agentWorkProductParserProfileDigest(),
    compilerProfileId: FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
    compilerProfileDigest: agentWorkProductCompilerProfileDigest(),
    citationRegistry: registry,
    citationRegistryDigest: providerInput.citationRegistryDigest,
    propositionSet: null,
    propositionSetDigest: null,
  });
  const markdown = (subject: string) => [
    "# Builder Work Product", "## Outcome", "- Disposition: complete", "- Uncertainty: bounded",
    "The exact Knowledge occurrence supports this bounded claim.",
    "## Claims", "### Claim: compared-meaning", "- Category: completed", "- State: proposed",
    "- Uncertainty: bounded", "- Knowledge: behavior.provider-input", "The selected meaning was inspected.",
    "## Citations", "### Citation: inspected-meaning", `- Subject: ${subject}`, "- Supports: compared-meaning",
    "## Proposal", "- Kind: ready-to-evaluate", "",
  ].join("\n");
  for (const occurrence of occurrences) {
    assert.equal(validateAgentWorkProductSemanticMarkdown(basis, markdown(occurrence.id)).status, "valid");
  }
  const unqualified = validateAgentWorkProductSemanticMarkdown(basis, markdown("behavior.provider-input"));
  assert.equal(unqualified.status, change === "none" ? "valid" : "invalid-result");
  if (change !== "none") assert.equal(unqualified.diagnostic?.code, "lifecycle.agent-work-product.invalid.citation-subject");
});
}

test("provider input v4 refuses citation collisions outside qualified Knowledge occurrences", () => {
  const projection = projectionWithExactSources().projection;
  const atlasIdentity = "atlas:target:atlas:target:-:-";
  const item = projection.manifest.mandatory[0]!;
  const { itemDigest: _itemDigest, ...itemSubject } = item;
  const mandatory = [buildMandatoryItem({ ...itemSubject, sourceIdentity: atlasIdentity })];
  const { digest: _digest, ...subject } = projection.manifest;
  const changed = { ...projection, manifest: { ...subject, mandatory, digest: selfDigest({ ...subject, mandatory }) } };
  assert.throws(() => compileProviderInputV4({
    projection: changed,
    operation: "delivery.prepare",
    roleSubjectDigest: digest("role-subject"),
    rootTokenSetDigest: digest("root-token-set"),
    capability: { candidateWrites: false, temporaryWrites: true, subprocesses: "none", network: "none", credentials: "none", externalEffects: [] },
    directorSemanticMarkdown: "Prepare one bounded proposal.\n",
  }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.attempt.provider-input-v4.citation");
});

test("provider input v4 refuses rehashed Knowledge revision metadata that contradicts equal source bytes", () => {
  for (const mutation of ["revision", "semantic-digest"] as const) {
    const projection = projectionWithKnowledgeOccurrences("none", mutation);
    // The fixture has recomputed every item and Projection digest; generic
    // structural verification alone cannot establish Knowledge correspondence.
    verifyCompiledProjection(projection);
    assert.throws(() => compileProviderInputV4({
      projection,
      operation: "delivery.prepare",
      roleSubjectDigest: digest("role-subject"),
      rootTokenSetDigest: digest("root-token-set"),
      capability: { candidateWrites: false, temporaryWrites: true, subprocesses: "none", network: "none", credentials: "none", externalEffects: [] },
      directorSemanticMarkdown: "Prepare one bounded proposal.\n",
    }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.projection.citation-identity-conflict");
  }
});
