import assert from "node:assert/strict";
import test from "node:test";
import {
  agentWorkProductCompilerProfileDigest,
  agentWorkProductFailureClassification,
  agentWorkProductParserProfileDigest,
  compileAgentWorkProductPayload,
  FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
  FOUNDATION_AGENT_WORK_PRODUCT_FIXED_BINDINGS_SCHEMA,
  FOUNDATION_AGENT_WORK_PRODUCT_PARSE_RESULT_SCHEMA,
  FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
  parseAgentWorkProductSemanticMarkdown,
  renderAgentWorkProductTemplate,
  type AgentWorkProductCitationRegistryEntry,
  type AgentWorkProductPropositionSet,
  type AgentWorkProductRole,
} from "../../src/foundation/control/agent-work-product-semantics.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { assertDeliveryControlRecordPayload } from "../../src/foundation/control/payload-registry.js";
import type {
  ControlJsonObject,
  ControlRecordRelationship,
  ControlRecordRevision,
} from "../../src/foundation/control/types.js";
import { digestCanonical, sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { compareCodePoints } from "../../src/foundation/validation/ordering.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const D0 = "sha256:0000000000000000000000000000000000000000000000000000000000000000" as const;
const D1 = "sha256:1111111111111111111111111111111111111111111111111111111111111111" as const;

function citationDigest(entries: readonly AgentWorkProductCitationRegistryEntry[]): Sha256 {
  return digestCanonical({
    schema: "lifecycle.attempt-citation-registry.v3",
    items: [...entries].sort((left, right) => compareCodePoints(left.id, right.id)),
  });
}

function attemptFor(
  role: AgentWorkProductRole,
  entries: readonly AgentWorkProductCitationRegistryEntry[],
  propositionSet: AgentWorkProductPropositionSet | null = null,
): ControlRecordRevision {
  const base = validDeliveryControlPayload("agent-attempt");
  const template = renderAgentWorkProductTemplate(role);
  const input = base.input as Record<string, unknown>;
  const authoring = base.authoring as Record<string, unknown>;
  const payload: ControlJsonObject = {
    ...base,
    operation: role === "reconnaissance"
      ? "delivery.prepare"
      : role === "builder"
        ? "delivery.continue"
        : "delivery.evaluate",
    role,
    authoring: {
      ...authoring,
      templateProfileId: template.profileId,
      templateDigest: template.digest,
      parserProfileId: FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
      parserProfileDigest: agentWorkProductParserProfileDigest(),
      compilerProfileId: FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
      compilerProfileDigest: agentWorkProductCompilerProfileDigest(),
    },
    input: {
      ...input,
      citationRegistryDigest: citationDigest(entries),
      evidenceSetDigest: role === "reconnaissance" ? null : D0,
      propositionSetDigest: propositionSet === null ? null : digestCanonical(propositionSet),
    },
  };
  const relationships: ControlRecordRelationship[] = [{
    relation: "uses-brief",
    target: { kind: "director-brief", id: "brief-one", revision: 1, digest: D0 },
  }];
  if (role !== "reconnaissance") {
    relationships.push({
      relation: "uses-boundary",
      target: { kind: "work-boundary", id: "boundary-one", revision: 1, digest: D1 },
    }, {
      relation: "uses-candidate",
      target: { kind: "candidate-revision", id: "candidate-one", revision: 3, digest: D0 },
    });
  }
  return compileControlRecordRevision("delivery-one", {
    recordId: `attempt-${role}`,
    recordKind: "agent-attempt",
    revision: 1,
    producer: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthor: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthority: "runtime-derived",
    createdAt: "2026-08-29T16:00:00Z",
    semanticMarkdown: `# Agent Attempt\n\nPrepare one ${role} invocation.\n`,
    payload,
    relationships,
  });
}

function compile(
  role: AgentWorkProductRole,
  markdown: string,
  entries: readonly AgentWorkProductCitationRegistryEntry[],
  propositionSet: AgentWorkProductPropositionSet | null = null,
  validatePayload = true,
): ControlJsonObject {
  const attempt = attemptFor(role, entries, propositionSet);
  const parsed = parseAgentWorkProductSemanticMarkdown(role, markdown);
  const bytes = Buffer.from(markdown);
  const payload = compileAgentWorkProductPayload({
    attempt,
    workspaceTemplateDigest: renderAgentWorkProductTemplate(role).digest,
    observation: {
      activityId: String(attempt.payload.activityId),
      editor: { kind: "agent", id: `agent-${role}` },
      rawDigest: sha256Bytes(bytes),
      rawByteLength: bytes.byteLength,
      semanticMarkdown: markdown,
      semanticDigest: sha256Bytes(markdown),
    },
    parsed,
    citationRegistry: entries,
    propositionSet,
  });
  const revision = compileControlRecordRevision("delivery-one", {
    recordId: `work-product-${role}`,
    recordKind: "agent-work-product",
    revision: 1,
    producer: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthor: { kind: "agent", id: `agent-${role}` },
    semanticAuthority: "agent-proposed",
    createdAt: "2026-08-29T16:00:01Z",
    semanticMarkdown: parsed.normalizedMarkdown,
    payload,
    relationships: [{
      relation: "result-of",
      target: { kind: "agent-attempt", id: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
    }],
  });
  if (validatePayload) assertDeliveryControlRecordPayload(revision);
  return payload;
}

test("current templates exclude agent-authored mechanics and use unanchored draft headings", () => {
  assert.equal(FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID, "lifecycle.agent-work-product-parser.v4");
  assert.equal(FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID, "lifecycle.agent-work-product-compiler.v4");
  assert.equal(FOUNDATION_AGENT_WORK_PRODUCT_PARSE_RESULT_SCHEMA, "lifecycle.agent-work-product-parse-result.v6");
  assert.equal(FOUNDATION_AGENT_WORK_PRODUCT_FIXED_BINDINGS_SCHEMA, "lifecycle.agent-work-product-fixed-bindings.v6");
  for (const role of ["reconnaissance", "builder", "reviewer"] as const) {
    const template = renderAgentWorkProductTemplate(role);
    assert.equal(template.profileId, `lifecycle.agent-work-product-body.${role}.v4`);
    assert.doesNotMatch(template.markdown, /\{#[^}]+\}/u);
    assert.doesNotMatch(template.markdown, /Director judgment required|Allow not applicable|None\./u);
    const obligation = template.markdown.match(/### Obligation:[\s\S]*?(?=\n### |$)/u)?.[0] ?? "";
    assert.doesNotMatch(obligation, /^- Proposition:/mu);
    if (role === "reconnaissance") {
      assert.match(template.markdown, /Baseline required: <true \| false; at least one Check must be true/u);
      assert.match(template.markdown, /postcondition records authorized not-run without baseline execution/u);
      assert.match(template.markdown, /Final required: <true \| false; at least one Check must be true/u);
    }
  }
});

test("reconnaissance retains optional work-type discovery and compiles complete typed Work Boundary semantics", () => {
  const registry = Object.freeze([Object.freeze({
    id: "behavior.delivery-loop",
    kind: "knowledge",
    knowledgeIdentity: "behavior.delivery-loop",
    digest: D0,
    locator: "projection/material/behavior.delivery-loop.md",
    authorityClass: "repository-authored" as const,
  }), Object.freeze({
    id: "check.delivery-loop",
    kind: "knowledge",
    knowledgeIdentity: "check.delivery-loop",
    digest: D1,
    locator: "projection/material/check.delivery-loop.md",
    authorityClass: "repository-authored" as const,
  }), Object.freeze({
    id: "discipline.go-review",
    kind: "knowledge",
    knowledgeIdentity: "discipline.go-review",
    digest: D0,
    locator: "projection/material/discipline.go-review.md",
    authorityClass: "repository-authored" as const,
  })]);
  const markdown = [
    "# Reconnaissance Work Product",
    "",
    "",
    "## Citations",
    "### Citation: citation-route",
    "- Supports: `claim-route`",
    "- Subject: `behavior.delivery-loop`",
    "",
    "### Citation: citation-check",
    "- Subject: check.delivery-loop",
    "- Supports: claim-route",
    "",
    "### Citation: citation-discipline",
    "- Subject: discipline.go-review",
    "- Supports: claim-route",
    "",
    "## Claims",
    "",
    "### Claim: claim-route",
    "- Knowledge: `behavior.delivery-loop`",
    "- Uncertainty: none",
    "- State: proposed",
    "- Category: route",
    "",
    "The exact behavior owner supports this route.",
    "",
    "## Outcome",
    "",
    "- Uncertainty: none",
    "",
    "The Delivery loop can be expressed as one exact bounded change.",
    "",
    "## Proposal",
    "- Selected Knowledge: `check.delivery-loop`",
    "- Kind: work-boundary",
    "- Projection profile: `execution-standard-v1`",
    "- Selected Knowledge: behavior.delivery-loop",
    "- Selected Knowledge: discipline.go-review",
    "- Selected work type: go-development",
    "- Capability profile: `builder-standard`",
    "",
    "### Objective",
    "Make the Candidate development loop explicit.",
    "",
    "### Mandate",
    "- Included: Retain complete typed Agent semantics.",
    "- Why now: The runtime needs one exact execution contract.",
    "",
    "Preserve one coherent Candidate development loop.",
    "",
    "### Obligation: obligation-loop",
    "- Severity: required",
    "- Required evidence artifact: artifact-runtime",
    "- Source: behavior.delivery-loop",
    "- Source: mandate",
    "- Kind: behavior",
    "",
    "The runtime consumes typed semantics without reparsing prose.",
    "",
    "### Artifact: artifact-runtime",
    "- Obligation: obligation-loop",
    "- Must change: true",
    "- Role: code",
    "- Path: `runtime/src/foundation/control/agent-work-product.ts`",
    "",
    "Compile the governed Markdown submission into Control.",
    "",
    "### Check: check-runtime",
    "- Final required: true",
    "- Binding: runtime-test",
    "- Check Knowledge: check.delivery-loop",
    "- Baseline required: true",
    "- Obligation: obligation-loop",
    "- Modality: postcondition",
    "",
    "Prove exact parser and compiler behavior.",
    "",
    "### Proposition: proposition-loop",
    "- Check: check-runtime",
    "- Obligation: obligation-loop",
    "- Evidence artifact: artifact-runtime",
    "- Evidence kind: artifact",
    "- Path: runtime/src/foundation/control/agent-work-product.ts",
    "",
    "The runtime retains complete typed Work Product semantics.",
    "",
  ].join("\n");
  const parsed = parseAgentWorkProductSemanticMarkdown("reconnaissance", markdown);
  assert.equal(parsed.disposition, "complete");
  assert.match(parsed.normalizedMarkdown, /### Claim: claim-route \{#claim-route\}/u);
  assert.match(parsed.normalizedMarkdown, /### Objective \{#objective\}/u);
  const payload = compile("reconnaissance", markdown, registry);
  const duplicateArtifact = markdown.replace("Citation: citation-route", "Citation: artifact-runtime");
  assert.throws(() => compile("reconnaissance", duplicateArtifact, registry), (error: unknown) => {
    const failure = error as { code: string; observedFacts: unknown };
    assert.equal(failure.code, "lifecycle.agent-work-product.invalid.duplicate-local-identity");
    assert.deepEqual(failure.observedFacts, { classification: "invalid-result", phase: "semantic", firstLine: 5,
      line: markdown.split("\n").indexOf("### Artifact: artifact-runtime") + 1, localHandle: "artifact-runtime" });
    return true;
  });
  const correctedArtifact = compile("reconnaissance", duplicateArtifact.replace("Citation: artifact-runtime", "Citation: cite-runtime"), registry);
  assert.equal((correctedArtifact.citations as unknown[]).length, 3, "Renaming the Citation keeps its Claim support and the Artifact definition");
  const result = payload.roleSemantics as Record<string, unknown>;
  const boundary = result.workBoundary as Record<string, unknown>;
  const obligations = boundary.obligations as Array<Record<string, unknown>>;
  const mandate = boundary.mandate as Record<string, unknown>;
  const propositions = boundary.propositions as Array<Record<string, unknown>>;
  assert.equal((payload.citations as unknown[]).length, 3);
  for (const phase of ["Baseline", "Final"] as const) {
    assert.throws(() => compile("reconnaissance", markdown.replace(
      `- ${phase} required: true`, `- ${phase} required: false`,
    ), registry), (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.agent-work-product.invalid.work-boundary-coverage" &&
      agentWorkProductFailureClassification(error) === "invalid-result" &&
      error.message.includes(`${phase.toLowerCase()}-required`));
  }
  assert.deepEqual(boundary.selectedWorkTypeIds, ["go-development"]);
  assert.deepEqual(boundary.selectedKnowledgeIds, ["behavior.delivery-loop", "check.delivery-loop", "discipline.go-review"]);
  assert.equal(obligations.length, 1);
  assert.deepEqual(obligations[0]!.sourceIds, ["behavior.delivery-loop", mandate.id]);
  assert.deepEqual(obligations[0]!.propositionIds, [propositions[0]!.id]);
  assert.equal(propositions[0]!.allowNotApplicable, false);
  assert.equal(propositions[0]!.notApplicableCondition, null);
  assert.equal((payload.body as { digest: string }).digest, sha256Bytes(parsed.normalizedMarkdown));
  const fragments = (payload.body as { fragments: Array<{ anchor: string }> }).fragments;
  assert(fragments.some(({ anchor }) => anchor === "claim-route"));
  const qualifiedRegistry = Object.freeze([...registry, ...registry.map((entry) => Object.freeze({
    ...entry,
    id: `knowledge.qualified-${entry.id}`,
  }))]);
  const qualifiedMarkdown = markdown
    .replace("- Subject: `behavior.delivery-loop`", "- Subject: knowledge.qualified-behavior.delivery-loop")
    .replace("- Subject: check.delivery-loop", "- Subject: knowledge.qualified-check.delivery-loop")
    .replace("- Subject: discipline.go-review", "- Subject: knowledge.qualified-discipline.go-review");
  const qualified = compile("reconnaissance", qualifiedMarkdown, qualifiedRegistry);
  assert.deepEqual(
    ((qualified.roleSemantics as ControlJsonObject).workBoundary as ControlJsonObject).selectedKnowledgeIds,
    ["behavior.delivery-loop", "check.delivery-loop", "discipline.go-review"],
  );
  assert((qualified.citations as readonly ControlJsonObject[]).every(({ subjectId }) => String(subjectId).startsWith("knowledge.qualified-")));
  assert.throws(
    () => compile(
      "reconnaissance",
      markdown.replace("- Source: mandate", "- Source: artifact-runtime"),
      registry,
    ),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.agent-work-product.invalid.work-boundary-source",
  );
  assert.throws(
    () => compile(
      "reconnaissance",
      markdown.replace(
        "- Selected Knowledge: behavior.delivery-loop",
        "- Selected Knowledge: behavior.delivery-loop\n- Selected source: mandate",
      ),
      registry,
    ),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.agent-work-product.invalid.work-boundary-source" &&
      error.message.includes("ambiguous"),
  );
});

test("reconnaissance Proposal Kind derives blocked and partial dispositions", () => {
  const preparation = [
    "# Reconnaissance Work Product",
    "## Outcome",
    "- Uncertainty: material",
    "A mandatory input is unavailable.",
    "## Claims",
    "### Claim: missing-input",
    "- Category: diagnosis",
    "- State: proposed",
    "- Uncertainty: material",
    "The missing input prevents an honest boundary.",
    "## Proposal",
    "- Kind: preparation-condition",
    "",
  ].join("\n");
  const parsed = parseAgentWorkProductSemanticMarkdown("reconnaissance", preparation);
  assert.equal(parsed.disposition, "blocked");
  const payload = compile("reconnaissance", preparation, []);
  assert.equal((payload.roleSemantics as Record<string, unknown>).proposal, "preparation-condition");
  assert.equal(((payload.roleSemantics as Record<string, unknown>).conditionIds as unknown[]).length, 1);

  const split = preparation
    .replace("- Kind: preparation-condition", "- Kind: split-recommended")
    .replace("- Category: diagnosis", "- Category: route");
  assert.equal(parseAgentWorkProductSemanticMarkdown("reconnaissance", split).disposition, "partial");
});

test("builder compilation permits omitted optional sections and derives the Director judgment requirement", () => {
  const progress = [
    "# Builder Work Product",
    "## Proposal",
    "- Remaining obligation: `obligation-tests`",
    "- Kind: progress",
    "## Outcome",
    "- Uncertainty: bounded",
    "- Disposition: partial",
    "The Candidate remains available for another bounded Attempt.",
    "",
  ].join("\n");
  const progressPayload = compile("builder", progress, []);
  assert.deepEqual((progressPayload.roleSemantics as Record<string, unknown>).remainingObligationIds, ["obligation-tests"]);

  const condition = [
    "# Builder Work Product",
    "## Outcome",
    "- Disposition: blocked",
    "- Uncertainty: material",
    "The active mandate requires a Director-owned tradeoff.",
    "## Proposal",
    "- Kind: material-condition",
    "### Material Condition: condition-tradeoff",
    "- Condition class: director-tradeoff",
    "The admitted tradeoff no longer selects one honest implementation route.",
    "",
  ].join("\n");
  const conditionPayload = compile("builder", condition, [], null, false);
  const conditions = (conditionPayload.roleSemantics as { conditions: Array<Record<string, unknown>> }).conditions;
  assert.equal(conditions[0]!.directorJudgmentRequired, true);
});

test("builder semantics refuse the retired product-state drift Material Condition class", () => {
  const markdown = [
    "# Builder Work Product",
    "## Outcome",
    "- Disposition: blocked",
    "- Uncertainty: material",
    "The canonical branch no longer matches the admitted repository epoch.",
    "## Proposal",
    "- Kind: material-condition",
    "### Material Condition: condition-drift",
    "- Condition class: incompatible-product-state-drift",
    "The canonical branch moved outside the active Delivery.",
    "",
  ].join("\n");

  assert.throws(
    () => parseAgentWorkProductSemanticMarkdown("builder", markdown),
    (error: unknown) => agentWorkProductFailureClassification(error) === "invalid-result",
  );
});

test("layout-equivalent drafts produce byte-identical canonical Markdown and fragment bindings", () => {
  const first = [
    "# Builder Work Product",
    "## Outcome",
    "- Disposition: partial",
    "- Uncertainty: bounded",
    "The Candidate advanced.",
    "## Claims",
    "### Claim: route",
    "- Category: route",
    "- State: proposed",
    "- Uncertainty: bounded",
    "- Path: `runtime/src/index.ts`",
    "A bounded route remains available.",
    "## Proposal",
    "- Kind: progress",
    "- Remaining obligation: obligation-two",
    "- Remaining obligation: obligation-one",
    "",
  ].join("\n");
  const second = [
    "# Builder Work Product",
    "",
    "",
    "## Proposal",
    "",
    "- Remaining obligation: obligation-one",
    "",
    "- Kind: `progress`",
    "- Remaining obligation: obligation-two",
    "",
    "",
    "## Claims",
    "",
    "### Claim: route",
    "",
    "- Path: runtime/src/index.ts",
    "- Uncertainty: bounded",
    "- Category: route",
    "- State: proposed",
    "",
    "",
    "A bounded route remains available.",
    "",
    "## Outcome",
    "",
    "- Uncertainty: bounded",
    "",
    "- Disposition: partial",
    "",
    "The Candidate advanced.",
    "",
  ].join("\n");
  const firstParsed = parseAgentWorkProductSemanticMarkdown("builder", first);
  const secondParsed = parseAgentWorkProductSemanticMarkdown("builder", second);
  assert.equal(secondParsed.normalizedMarkdown, firstParsed.normalizedMarkdown);
  const firstPayload = compile("builder", first, []);
  const secondPayload = compile("builder", second, []);
  assert.equal(
    (secondPayload.summary as { fragmentDigest: string }).fragmentDigest,
    (firstPayload.summary as { fragmentDigest: string }).fragmentDigest,
  );
  assert.deepEqual(secondPayload.claims, firstPayload.claims);
  assert.deepEqual(secondPayload.body, firstPayload.body);
  assert.notEqual(secondPayload.parseResultDigest, firstPayload.parseResultDigest);
});

test("all roles parse no-product Outcome semantics without a marker section", () => {
  const values = Object.freeze({
    reconnaissance: [
      "# Reconnaissance Work Product",
      "## Outcome",
      "- No-product reason: no-honest-route",
      "- Uncertainty: unknown",
      "No honest route is available.",
      "## Proposal",
      "- Kind: no-product",
      "",
    ].join("\n"),
    builder: [
      "# Builder Work Product",
      "## Outcome",
      "- No-product reason: unsupported-capability",
      "- Uncertainty: unknown",
      "- Disposition: no-product",
      "No useful product can be supplied.",
      "",
    ].join("\n"),
    reviewer: [
      "# Reviewer Work Product",
      "## Outcome",
      "- Disposition: no-product",
      "- Uncertainty: unknown",
      "- No-product reason: inaccessible-required-material",
      "No review product can be supplied.",
      "",
    ].join("\n"),
  });
  for (const role of ["reconnaissance", "builder", "reviewer"] as const) {
    const parsed = parseAgentWorkProductSemanticMarkdown(role, values[role]);
    assert.equal(parsed.disposition, "no-product");
    assert.notEqual(parsed.noProductReason, null);
    assert.match(parsed.normalizedMarkdown, /^- No-product reason: /mu);
    assert.equal((compile(role, values[role], []).roleSemantics as Record<string, unknown>).role, role);
  }
});

test("reviewer semantics resolve exact citations and proposition coverage", () => {
  const registry = Object.freeze([Object.freeze({
    id: "evidence.packet-one",
    kind: "evidence",
    knowledgeIdentity: null,
    digest: D0,
    locator: "evidence/packet-one",
    authorityClass: "runtime-derived" as const,
  })]);
  const propositionSet = Object.freeze({
    schema: "lifecycle.proposition-set.v3" as const,
    propositions: Object.freeze([Object.freeze({ id: "proposition-one", claim: "The Candidate satisfies the mandate." })]),
  });
  const markdown = [
    "# Reviewer Work Product",
    "## Outcome",
    "- Disposition: complete",
    "- Uncertainty: bounded",
    "Independent review covers the frozen proposition set.",
    "## Claims",
    "### Claim: claim-evidence",
    "- Category: completed",
    "- State: proposed",
    "- Uncertainty: bounded",
    "- Evidence: evidence.packet-one",
    "The retained Evidence supports the proposition.",
    "## Citations",
    "### Citation: citation-evidence",
    "- Subject: evidence.packet-one",
    "- Supports: claim-evidence",
    "## Review",
    "- Mandate excess: false",
    "### Mandate Applicability: mandate-applicability",
    "- Disposition: applicable", "- Citation: citation-evidence",
    "The admitted mandate still governs the exact integration parent and result.",
    "### Decision: decision-one",
    "- Proposition: proposition-one",
    "- Disposition: accepted",
    "- Citation: citation-evidence",
    "- Uncertainty: bounded",
    "The exact retained Evidence supports this proposition.",
    "",
  ].join("\n");
  const payload = compile("reviewer", markdown, registry, propositionSet);
  const judgments = (payload.roleSemantics as { judgments: Array<Record<string, unknown>> }).judgments;
  assert.equal(judgments[0]!.propositionId, "proposition-one");
  assert.deepEqual(judgments[0]!.inspectedSubjectIds, ["evidence.packet-one"]);

  // A mandate finding must carry its typed resolution proposal. Neither a
  // rejected proposition nor advice in prose manufactures that proposal.
  const condition = [
    "### Material Condition: condition-check-requirement",
    "- Condition class: meaning-ambiguity",
    "The admitted requirement needs Director clarification before another exact evaluation.",
  ].join("\n");
  const requiresReadmission = markdown.replace("- Disposition: applicable", "- Disposition: requires-readmission");
  assert.throws(() => compile("reviewer", requiresReadmission, registry, propositionSet),
    { code: "lifecycle.agent-work-product.invalid.material-condition-correspondence" });
  const paired = requiresReadmission.replace("### Decision: decision-one", `${condition}\n### Decision: decision-one`);
  const pairedReview = compile("reviewer", paired, registry, propositionSet).roleSemantics as {
    mandateApplicability: { disposition: string }; conditions: unknown[];
  };
  assert.equal(pairedReview.mandateApplicability.disposition, "requires-readmission");
  assert.equal(pairedReview.conditions.length, 1);
  assert.throws(() => compile("reviewer", paired.replace("- Disposition: requires-readmission", "- Disposition: applicable"), registry, propositionSet),
    { code: "lifecycle.agent-work-product.invalid.material-condition-correspondence" });
  assert.throws(() => compile("reviewer", paired.replace("- Citation: citation-evidence", "- Citation: absent-citation"), registry, propositionSet),
    { code: "lifecycle.agent-work-product.invalid.local-reference" });
  const rejected = compile("reviewer", markdown.replace("- Disposition: accepted", "- Disposition: rejected"), registry, propositionSet);
  assert.deepEqual((rejected.roleSemantics as { conditions: unknown[] }).conditions, []);

  // Actual rejected review: a Claim categorized as a limitation was referenced
  // by Decision Limitation. Local uniqueness does not make kinds substitutable.
  const wrongKind = paired.replace("- Category: completed", "- Category: limitation")
    .replace("- Proposition: proposition-one", "- Proposition: proposition-one\n- Limitation: claim-evidence");
  assert.throws(() => compile("reviewer", wrongKind, registry, propositionSet),
    { code: "lifecycle.agent-work-product.invalid.local-reference" });
  const correctedKind = wrongKind.replace("- Limitation: claim-evidence", "- Limitation: limit-proof")
    .replace("## Review", "## Limitations\n### Limitation: limit-proof\nThe required final Check is unavailable.\n## Review");
  const correctedPayload = compile("reviewer", correctedKind, registry, propositionSet);
  const correctedReview = correctedPayload.roleSemantics as { judgments: Array<{ limitationIds: string[] }> };
  const retainedLimitations = correctedPayload.limitations as Array<{ id: string }>;
  assert.equal(retainedLimitations.length, 1);
  assert.deepEqual(correctedReview.judgments[0]!.limitationIds, [retainedLimitations[0]!.id]);
});

test("reviewer semantics bind stable Knowledge claims to each exact admitted and Candidate citation", () => {
  const registry: readonly AgentWorkProductCitationRegistryEntry[] = [
    { id: "knowledge.admitted-occurrence", kind: "knowledge", knowledgeIdentity: "behavior.delivery-loop", digest: D0, locator: "projection/material/admitted.md", authorityClass: "repository-authored" },
    { id: "knowledge.candidate-occurrence", kind: "knowledge", knowledgeIdentity: "behavior.delivery-loop", digest: D1, locator: "projection/material/candidate.md", authorityClass: "repository-authored" },
  ];
  const propositionSet = {
    schema: "lifecycle.proposition-set.v3" as const,
    propositions: [{ id: "proposition-one", claim: "The Candidate makes the admitted Knowledge change." }],
  };
  const markdown = [
    "# Reviewer Work Product", "## Outcome", "- Disposition: complete", "- Uncertainty: bounded",
    "Independent review compares the admitted and proposed Knowledge.",
    "## Claims", "### Claim: compared-meaning", "- Category: completed", "- State: proposed",
    "- Uncertainty: bounded", "- Knowledge: behavior.delivery-loop", "The proposed revision satisfies the admitted result.",
    "## Citations", "### Citation: admitted-meaning", "- Subject: knowledge.admitted-occurrence", "- Supports: compared-meaning",
    "### Citation: candidate-meaning", "- Subject: knowledge.candidate-occurrence", "- Supports: compared-meaning",
    "## Review", "- Mandate excess: false",
    "### Mandate Applicability: mandate-applicability", "- Disposition: applicable", "- Citation: admitted-meaning", "- Citation: candidate-meaning",
    "The exact integration parent and result remain within the admitted mandate.",
    "### Decision: decision-one", "- Proposition: proposition-one",
    "- Disposition: accepted", "- Citation: admitted-meaning", "- Citation: candidate-meaning", "- Uncertainty: bounded",
    "The exact proposed revision satisfies the admitted change.", "",
  ].join("\n");
  const payload = compile("reviewer", markdown, registry, propositionSet);
  const citations = payload.citations as readonly ControlJsonObject[];
  for (const selected of registry) {
    const retained = citations.find(({ subjectId }) => subjectId === selected.id)!;
    assert.equal(retained.subjectDigest, selected.digest);
    assert.equal(retained.locator, selected.locator);
    assert.equal(retained.authorityClass, "repository-authored");
  }
  assert.deepEqual((payload.claims as readonly ControlJsonObject[])[0]!.knowledgeIds, ["behavior.delivery-loop"]);
  assert.throws(() => compile("reviewer", markdown.replace("- Subject: knowledge.admitted-occurrence", "- Subject: behavior.delivery-loop"), registry, propositionSet),
    (error: unknown) => (error as { code?: string }).code === "lifecycle.agent-work-product.invalid.citation-subject");
  assert.throws(() => compile("reviewer", markdown.replace("- Knowledge: behavior.delivery-loop", "- Knowledge: behavior.another-result"), registry, propositionSet),
    (error: unknown) => (error as { code?: string }).code === "lifecycle.agent-work-product.invalid.claim-support");
  const attempt = attemptFor("reviewer", registry, propositionSet);
  const remappedRegistry = registry.map((entry) => ({ ...entry, knowledgeIdentity: "behavior.another-result" }));
  assert.throws(() => compileAgentWorkProductPayload({
    attempt,
    workspaceTemplateDigest: renderAgentWorkProductTemplate("reviewer").digest,
    observation: {
      activityId: String(attempt.payload.activityId),
      editor: { kind: "agent", id: "agent-reviewer" },
      rawDigest: sha256Bytes(markdown),
      rawByteLength: Buffer.byteLength(markdown),
      semanticMarkdown: markdown,
      semanticDigest: sha256Bytes(markdown),
    },
    parsed: parseAgentWorkProductSemanticMarkdown("reviewer", markdown),
    citationRegistry: remappedRegistry,
    propositionSet,
  }), (error: unknown) => (error as { code?: string }).code === "lifecycle.agent-work-product.runtime.citation-registry");
});

test("the semantic parser rejects authored mechanics, anchors, unknown sections, and front matter", () => {
  const classify = (error: unknown): boolean => agentWorkProductFailureClassification(error) === "invalid-result";
  assert.throws(
    () => parseAgentWorkProductSemanticMarkdown("builder", "---\n{}\n---\n# Builder Work Product\n"),
    classify,
  );
  const valid = [
    "# Builder Work Product",
    "## Outcome",
    "- Disposition: partial",
    "- Uncertainty: bounded",
    "Progress.",
    "## Proposal",
    "- Kind: progress",
    "",
  ].join("\n");
  assert.throws(
    () => parseAgentWorkProductSemanticMarkdown("builder", valid.replace("Progress.", "- Digest: sha256:deadbeef\nProgress.")),
    classify,
  );
  assert.throws(
    () => parseAgentWorkProductSemanticMarkdown("builder", valid.replace("## Proposal", "## Unknown")),
    classify,
  );
  assert.throws(
    () => parseAgentWorkProductSemanticMarkdown("builder", valid.replace("- Kind: progress", "### Effect: effect-one {#effect-one}")),
    classify,
  );
});
