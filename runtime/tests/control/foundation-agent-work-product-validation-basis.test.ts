import assert from "node:assert/strict";
import test from "node:test";
import {
  agentWorkProductCompilerProfileDigest,
  agentWorkProductParserProfileDigest,
  createAgentWorkProductValidationBasis,
  FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
  FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
  renderAgentWorkProductTemplate,
  validateAgentWorkProductSemanticMarkdown,
  type AgentWorkProductCitationRegistryEntry,
  type AgentWorkProductRole,
  type AgentWorkProductValidationBasis,
} from "../../src/foundation/control/agent-work-product-semantics.js";
import { digestCanonical, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { compareCodePoints } from "../../src/foundation/validation/ordering.js";

const D0 = "sha256:0000000000000000000000000000000000000000000000000000000000000000" as const;
const D1 = "sha256:1111111111111111111111111111111111111111111111111111111111111111" as const;

function citationRegistryDigest(entries: readonly AgentWorkProductCitationRegistryEntry[]): Sha256 {
  return digestCanonical({
    schema: "lifecycle.attempt-citation-registry.v3",
    items: [...entries].sort((left, right) => compareCodePoints(left.id, right.id)),
  });
}

function basis(
  entries: readonly AgentWorkProductCitationRegistryEntry[] = Object.freeze([]),
  role: AgentWorkProductRole = "builder",
): AgentWorkProductValidationBasis {
  return createAgentWorkProductValidationBasis({
    role,
    templateDigest: renderAgentWorkProductTemplate(role).digest,
    parserProfileId: FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
    parserProfileDigest: agentWorkProductParserProfileDigest(),
    compilerProfileId: FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
    compilerProfileDigest: agentWorkProductCompilerProfileDigest(),
    citationRegistryDigest: citationRegistryDigest(entries),
    citationRegistry: entries,
    propositionSetDigest: null,
    propositionSet: null,
  });
}

const VALID_BUILDER = [
  "# Builder Work Product",
  "## Outcome",
  "- Disposition: complete",
  "- Uncertainty: none",
  "The bounded Candidate work is ready for evaluation.",
  "## Proposal",
  "- Kind: ready-to-evaluate",
  "",
].join("\n");

test("compact validation basis accepts semantic Markdown through the shared compiler", () => {
  const value = basis();
  assert.deepEqual(validateAgentWorkProductSemanticMarkdown(value, VALID_BUILDER), {
    status: "valid",
    diagnostic: null,
  });
  assert.equal(value.bodyProfileId, "lifecycle.agent-work-product-body.builder.v2");
  assert.match(value.digest, /^sha256:[a-f0-9]{64}$/u);
});

test("validation basis is deterministic and retains only sorted citation id/kind facts", () => {
  const entries = Object.freeze([
    Object.freeze({
      id: "knowledge.beta",
      kind: "knowledge" as const,
      digest: D1,
      locator: "private://knowledge/beta",
      authorityClass: "repository-authored" as const,
    }),
    Object.freeze({
      id: "evidence.alpha",
      kind: "evidence" as const,
      digest: D0,
      locator: "private://evidence/alpha",
      authorityClass: "runtime-observed" as const,
    }),
  ]);
  const first = basis(entries);
  const second = basis(Object.freeze([...entries].reverse()));
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first, second);
  assert.deepEqual(first.citationFacts, [
    { id: "evidence.alpha", kind: "evidence" },
    { id: "knowledge.beta", kind: "knowledge" },
  ]);
  const retained = JSON.stringify(first);
  assert.doesNotMatch(retained, /private:\/\//u);
  assert.doesNotMatch(retained, /repository-authored|runtime-observed/u);
  assert.doesNotMatch(retained, new RegExp(D0, "u"));
  assert.doesNotMatch(retained, new RegExp(D1, "u"));
});

test("reviewer basis retains only sorted proposition identities and their frozen digest", () => {
  const propositionSet = Object.freeze({
    schema: "lifecycle.proposition-set.v3" as const,
    propositions: Object.freeze([
      Object.freeze({ id: "proposition.two", claim: "private-proposition-two" }),
      Object.freeze({ id: "proposition.one", claim: "private-proposition-one" }),
    ]),
  });
  const exactPropositionSet = Object.freeze({
    schema: propositionSet.schema,
    propositions: Object.freeze([...propositionSet.propositions].sort((left, right) =>
      compareCodePoints(left.id, right.id))),
  });
  const role = "reviewer" as const;
  const value = createAgentWorkProductValidationBasis({
    role,
    templateDigest: renderAgentWorkProductTemplate(role).digest,
    parserProfileId: FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
    parserProfileDigest: agentWorkProductParserProfileDigest(),
    compilerProfileId: FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
    compilerProfileDigest: agentWorkProductCompilerProfileDigest(),
    citationRegistryDigest: citationRegistryDigest([]),
    citationRegistry: [],
    propositionSetDigest: digestCanonical(exactPropositionSet),
    propositionSet,
  });
  assert.deepEqual(value.propositionIds, ["proposition.one", "proposition.two"]);
  assert.equal(value.propositionSetDigest, digestCanonical(exactPropositionSet));
  assert.doesNotMatch(JSON.stringify(value), /private-proposition/u);
});

test("shared semantic compiler rejects a citation outside the frozen minimal registry", () => {
  const sensitiveMarkdown = [
    "# Builder Work Product",
    "## Outcome",
    "- Disposition: complete",
    "- Uncertainty: none",
    "private-summary-marker",
    "## Claims",
    "### Claim: private-claim",
    "- Category: completed",
    "- State: observed",
    "- Uncertainty: none",
    "A private claim marker.",
    "## Citations",
    "### Citation: private-citation",
    "- Subject: secret.subject",
    "- Supports: private-claim",
    "## Proposal",
    "- Kind: ready-to-evaluate",
    "",
  ].join("\n");
  const result = validateAgentWorkProductSemanticMarkdown(basis(), sensitiveMarkdown);
  assert.equal(result.status, "invalid-result");
  assert.equal(result.diagnostic?.phase, "semantic");
  assert.equal(result.diagnostic?.correction, "correct-semantic-draft");
  assert.equal(result.diagnostic?.code, "lifecycle.agent-work-product.invalid.citation-subject");
  const publicResult = JSON.stringify(result);
  assert.doesNotMatch(publicResult, /private-summary-marker|private-claim|private-citation|secret\.subject/u);
  assert.equal(result.diagnostic?.subject, null);
  assert.equal(result.diagnostic?.localHandle, null);
  assert.deepEqual(result.diagnostic?.expected, []);
});

test("syntax diagnostics expose only a safe code and bounded line", () => {
  const invalid = "# Builder Work Product\n---\n";
  const result = validateAgentWorkProductSemanticMarkdown(basis(), invalid);
  assert.equal(result.status, "invalid-result");
  assert.deepEqual(result.diagnostic, {
    code: "lifecycle.agent-work-product.invalid.delimiter",
    phase: "template",
    correction: "correct-semantic-draft",
    line: 2,
    subject: null,
    localHandle: null,
    expected: [],
  });
});

test("tampered durable basis stops validation as a runtime failure", () => {
  const exact = basis();
  const tampered = Object.freeze({
    ...exact,
    citationRegistryDigest: D1,
  }) as AgentWorkProductValidationBasis;
  const result = validateAgentWorkProductSemanticMarkdown(tampered, VALID_BUILDER);
  assert.equal(result.status, "runtime-failure");
  assert.equal(result.diagnostic?.phase, "compiler");
  assert.equal(result.diagnostic?.correction, "stop-runtime-failure");
  assert.equal(result.diagnostic?.code, "lifecycle.agent-work-product.runtime.validation-basis");
});
