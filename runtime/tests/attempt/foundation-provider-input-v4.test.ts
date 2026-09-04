import assert from "node:assert/strict";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
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
import {
  foundationAttemptProjectionFixture,
  type FoundationAttemptProjectionBuilderSubject,
  type FoundationAttemptProjectionOrientationSubject,
} from "../helpers/foundation-attempt-projection-fixture.js";

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
    sourceDigest: digest("knowledge-source"),
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
  founderSemanticMarkdown = "# Founder request\n\nInspect the exact projected inputs.\n",
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
    founderSemanticMarkdown,
  });
  return Object.freeze({ ...fixture, providerInput });
}

function projectionWithAmbiguousCitation(): FoundationCompiledProjection {
  const source = projectionWithExactSources().projection;
  const original = source.manifest.mandatory[0]!;
  const { itemDigest: _itemDigest, ...originalSubject } = original;
  const duplicate = buildMandatoryItem({
    ...originalSubject,
    id: "projection-item.behavior.provider-input-conflict",
    revision: 2,
    semanticDigest: digest("conflicting-knowledge-semantics"),
  });
  const mandatory = Object.freeze([original, duplicate]);
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

test("provider input v4 renders only readable briefing and exact projected source files", () => {
  const first = compile();
  const second = compile();
  verifyProviderInputV4(first.providerInput, first.projection);
  assert.equal(first.providerInput.inputMaterial.layoutProfileId, PROVIDER_INPUT_V4_LAYOUT);
  assert.equal(PROVIDER_INPUT_V4_LAYOUT, "lifecycle.agent-provider-input.standard-v6");
  assert.equal(first.providerInput.inventory.schema, "lifecycle.agent-input-content-inventory.v6");
  assert.equal(first.providerInput.inputMaterial.schema, "lifecycle.agent-input-material.v6");
  assert.equal(PROVIDER_INPUT_V4_MANIFEST_SCHEMA, "lifecycle.agent-input-bundle-manifest.v6");
  assert.equal(PROVIDER_INPUT_V4_TREE_SCHEMA, "lifecycle.agent-input-bundle-tree.v6");
  assert.equal(first.providerInput.inputMaterialDigest, second.providerInput.inputMaterialDigest);
  assert.equal(first.providerInput.bundleDigest, second.providerInput.bundleDigest);
  assert.deepEqual(first.providerInput.contents.map(({ path }) => path), [
    "role-brief.md",
    "sources/00001-atlas-target-atlas-target.json",
    "sources/00002-behavior.provider-input.md",
    "sources/00003-behavior.related-provider-input.txt",
  ]);
  const brief = first.providerInput.roleBrief.markdown;
  assert.match(brief, /^# Role Brief\n/u);
  assert.match(brief, /## Founder Direction\n\n.*\n\n> # Founder request\n>\n> Inspect the exact projected inputs\./u);
  assert.match(brief, /Edit the supplied semantic\.md file directly/u);
  assert.match(brief, /runtime independently validates the exact final file/u);
  assert.match(brief, /Projection or citation alone does not select a source/u);
  assert.doesNotMatch(brief, /^---$/mu);
  assert.doesNotMatch(brief, /sha256:|projection:|Attempt:|Invocation:|front matter bytes/u);
  assert.doesNotMatch(brief, /manifest\.json|subject\.json|attempt\.md/u);
  assert.equal(first.providerInput.contents.some(({ path }) => path.endsWith("template.md")), false);
  const atlasContent = first.projection.manifest.atlas[0]!.content;
  assert.equal(atlasContent.mode, "inline");
  if (atlasContent.mode !== "inline") assert.fail("Atlas fixture content is not inline");
  assert.deepEqual(
    Buffer.from(first.providerInput.contents[1]!.bytes),
    Buffer.from(atlasContent.text, "utf8"),
  );
  assert.deepEqual(
    Buffer.from(first.providerInput.contents[2]!.bytes),
    first.knowledgeBytes,
  );
  assert.deepEqual(
    Buffer.from(first.providerInput.contents[3]!.bytes),
    first.reachableBytes,
  );
  assert.deepEqual(first.providerInput.citationRegistry.map(({ id, locator }) => ({ id, locator })), [
    { id: "atlas:target:atlas:target:-:-", locator: "sources/00001-atlas-target-atlas-target.json" },
    { id: "behavior.provider-input", locator: "sources/00002-behavior.provider-input.md" },
    { id: "behavior.related-provider-input", locator: "sources/00003-behavior.related-provider-input.txt" },
  ]);
  assert.equal(first.providerInput.citationRegistry[0]?.authorityClass, "repository-authored");
  assert.equal(first.providerInput.citationRegistry[0]?.digest, first.projection.manifest.atlas[0]?.normalizedDigest);
});

test("provider input v4 binds normalized Founder direction through every provider-input identity", () => {
  const first = compile();
  const changed = compile("# Founder request\n\nInspect only the exact Candidate surface.\n");
  assert.equal(
    first.providerInput.founderDirection.markdown,
    "# Founder request\n\nInspect the exact projected inputs.\n",
  );
  assert.equal(
    first.providerInput.founderDirection.digest,
    sha256Bytes(first.providerInput.founderDirection.markdown),
  );
  assert.equal(
    first.providerInput.founderDirection.byteLength,
    Buffer.byteLength(first.providerInput.founderDirection.markdown, "utf8"),
  );
  assert.equal(
    first.providerInput.inputMaterial.founderDirectionDigest,
    first.providerInput.founderDirection.digest,
  );
  assert.notEqual(first.providerInput.founderDirection.digest, changed.providerInput.founderDirection.digest);
  assert.notEqual(first.providerInput.roleBrief.digest, changed.providerInput.roleBrief.digest);
  assert.notEqual(first.providerInput.inputMaterialDigest, changed.providerInput.inputMaterialDigest);
  assert.notEqual(first.providerInput.manifestDigest, changed.providerInput.manifestDigest);
  assert.notEqual(first.providerInput.bundleDigest, changed.providerInput.bundleDigest);

  const tampered = Object.freeze({
    ...first.providerInput,
    founderDirection: Object.freeze({
      ...first.providerInput.founderDirection,
      markdown: "# Founder request\n\nTampered direction.\n",
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
    founderSemanticMarkdown: "Continue implementation against the current Candidate.\n",
  });
  const brief = providerInput.roleBrief.markdown;
  assert.match(brief, /### Assumptions/u);
  assert.match(brief, /### Falsifiers/u);
  assert.match(brief, /obligation\.fixture\.builder \[acceptance\]/u);
  assert.match(brief, /proposition\.fixture\.builder: .*evidence: evidence\.provider-input-v4/u);
  assert.match(brief, /not-applicable allowed: false/u);
  assert.match(brief, /### Capability Direction/u);
  assert.match(brief, /Prohibited effects:/u);
  assert.match(brief, /Material Condition rule:/u);
  assert.doesNotMatch(brief, /sha256:|front matter bytes|Attempt:|Invocation:/u);
  assert.deepEqual(providerInput.contents.map(({ path }) => path), [
    "role-brief.md",
    "sources/00001-atlas-target-atlas-target.json",
  ]);
});

test("provider input v4 refuses role or capability widening during compilation", () => {
  const fixture = projectionWithExactSources();
  const common = {
    projection: fixture.projection,
    roleSubjectDigest: digest("role-subject"),
    rootTokenSetDigest: digest("root-token-set"),
    founderSemanticMarkdown: "Prepare one bounded proposal.\n",
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

test("provider input v4 refuses a Projection that repeats one citation identity", () => {
  assert.throws(() => compileProviderInputV4({
    projection: projectionWithAmbiguousCitation(),
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
    founderSemanticMarkdown: "Prepare one bounded proposal.\n",
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.attempt.provider-input-v4.citation");
});
