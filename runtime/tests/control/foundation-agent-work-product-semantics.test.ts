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
    target: { kind: "founder-brief", id: "brief-one", revision: 1, digest: D0 },
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

test("v2 templates remove agent-authored mechanics and use unanchored draft headings", () => {
  assert.equal(FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID, "lifecycle.agent-work-product-parser.v2");
  assert.equal(FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID, "lifecycle.agent-work-product-compiler.v2");
  assert.equal(FOUNDATION_AGENT_WORK_PRODUCT_PARSE_RESULT_SCHEMA, "lifecycle.agent-work-product-parse-result.v6");
  assert.equal(FOUNDATION_AGENT_WORK_PRODUCT_FIXED_BINDINGS_SCHEMA, "lifecycle.agent-work-product-fixed-bindings.v6");
  for (const role of ["reconnaissance", "builder", "reviewer"] as const) {
    const template = renderAgentWorkProductTemplate(role);
    assert.equal(template.profileId, `lifecycle.agent-work-product-body.${role}.v2`);
    assert.doesNotMatch(template.markdown, /\{#[^}]+\}/u);
    assert.doesNotMatch(template.markdown, /Founder judgment required|Allow not applicable|None\./u);
    const obligation = template.markdown.match(/### Obligation:[\s\S]*?(?=\n### |$)/u)?.[0] ?? "";
    assert.doesNotMatch(obligation, /^- Proposition:/mu);
  }
});

test("reconnaissance v2 derives mechanics and compiles complete typed Work Boundary semantics", () => {
  const registry = Object.freeze([Object.freeze({
    id: "behavior.delivery-loop",
    kind: "knowledge",
    digest: D0,
    locator: "projection/material/behavior.delivery-loop.md",
    authorityClass: "repository-authored" as const,
  }), Object.freeze({
    id: "check.delivery-loop",
    kind: "knowledge",
    digest: D1,
    locator: "projection/material/check.delivery-loop.md",
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
    "- Baseline required: false",
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
  const result = payload.roleSemantics as Record<string, unknown>;
  const boundary = result.workBoundary as Record<string, unknown>;
  const obligations = boundary.obligations as Array<Record<string, unknown>>;
  const mandate = boundary.mandate as Record<string, unknown>;
  const propositions = boundary.propositions as Array<Record<string, unknown>>;
  assert.equal((payload.citations as unknown[]).length, 2);
  assert.equal(obligations.length, 1);
  assert.deepEqual(obligations[0]!.sourceIds, ["behavior.delivery-loop", mandate.id]);
  assert.deepEqual(obligations[0]!.propositionIds, [propositions[0]!.id]);
  assert.equal(propositions[0]!.allowNotApplicable, false);
  assert.equal(propositions[0]!.notApplicableCondition, null);
  assert.equal((payload.body as { digest: string }).digest, sha256Bytes(parsed.normalizedMarkdown));
  const fragments = (payload.body as { fragments: Array<{ anchor: string }> }).fragments;
  assert(fragments.some(({ anchor }) => anchor === "claim-route"));
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

test("builder v2 permits omitted optional sections and derives Founder judgment mechanics", () => {
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
    "The active mandate requires a Founder-owned tradeoff.",
    "## Proposal",
    "- Kind: material-condition",
    "### Material Condition: condition-tradeoff",
    "- Condition class: founder-tradeoff",
    "The admitted tradeoff no longer selects one honest implementation route.",
    "",
  ].join("\n");
  const conditionPayload = compile("builder", condition, [], null, false);
  const conditions = (conditionPayload.roleSemantics as { conditions: Array<Record<string, unknown>> }).conditions;
  assert.equal(conditions[0]!.founderJudgmentRequired, true);
});

test("builder v2 refuses the retired product-state drift Material Condition class", () => {
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

test("reviewer v2 resolves exact citations and proposition coverage", () => {
  const registry = Object.freeze([Object.freeze({
    id: "evidence.packet-one",
    kind: "evidence",
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
});

test("v2 rejects authored mechanics, anchors, unknown sections, and front matter", () => {
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
