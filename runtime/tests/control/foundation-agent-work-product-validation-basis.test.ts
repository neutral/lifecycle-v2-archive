import { inspectFoundationSemanticDraftV1 } from "../../src/foundation/draft/semantic.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  agentWorkProductCompilerProfileDigest,
  agentWorkProductParserProfileDigest,
  createAgentWorkProductValidationBasis,
  FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
  FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
  parseAgentWorkProductSemanticMarkdown,
  renderAgentWorkProductTemplate,
  validateAgentWorkProductSemanticMarkdown,
  type AgentWorkProductCitationRegistryEntry,
  type AgentWorkProductPropositionSet,
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
  propositionSet: AgentWorkProductPropositionSet | null = null,
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
    propositionSetDigest: propositionSet === null ? null : digestCanonical(propositionSet),
    propositionSet,
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
  assert.equal(value.bodyProfileId, "lifecycle.agent-work-product-body.builder.v4");
  assert.match(value.digest, /^sha256:[a-f0-9]{64}$/u);
});

test("validation basis retains sorted citation identities, kinds, and Knowledge mappings", () => {
  const entries = Object.freeze([
    Object.freeze({
      id: "knowledge.beta",
      kind: "knowledge" as const,
      knowledgeIdentity: "behavior.beta",
      digest: D1,
      locator: "private://knowledge/beta",
      authorityClass: "repository-authored" as const,
    }),
    Object.freeze({
      id: "evidence.alpha",
      kind: "evidence" as const,
      knowledgeIdentity: null,
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
    { id: "evidence.alpha", kind: "evidence", knowledgeIdentity: null },
    { id: "knowledge.beta", kind: "knowledge", knowledgeIdentity: "behavior.beta" },
  ]);
  const retained = JSON.stringify(first);
  assert.doesNotMatch(retained, /private:\/\//u);
  assert.doesNotMatch(retained, /repository-authored|runtime-observed/u);
  assert.doesNotMatch(retained, new RegExp(D0, "u"));
  assert.doesNotMatch(retained, new RegExp(D1, "u"));
});

test("validation basis refuses stale or malformed citation Knowledge mappings", () => {
  const current = {
    id: "knowledge.qualified",
    kind: "knowledge" as const,
    knowledgeIdentity: "behavior.beta",
    digest: D1,
    locator: "projection/material/beta.md",
    authorityClass: "repository-authored" as const,
  };
  const { knowledgeIdentity: _identity, ...stale } = current;
  for (const entry of [stale, { ...current, knowledgeIdentity: null }, { ...current, kind: "evidence" }]) {
    assert.throws(() => basis([entry] as readonly AgentWorkProductCitationRegistryEntry[]));
  }
  assert.throws(() => basis([
    current,
    { ...current, id: current.knowledgeIdentity, digest: D0 },
  ]), (error: unknown) => (error as { code?: string }).code === "lifecycle.agent-work-product.runtime.citation-registry");
  const exact = basis([current]);
  const { knowledgeIdentity: _factIdentity, ...staleFact } = exact.citationFacts[0]!;
  const staleSubject = { ...exact, citationFacts: [staleFact] };
  const { digest: _digest, ...subject } = staleSubject;
  const staleBasis = { ...subject, digest: digestCanonical(subject) } as unknown as AgentWorkProductValidationBasis;
  assert.equal(validateAgentWorkProductSemanticMarkdown(staleBasis, VALID_BUILDER).status, "runtime-failure");
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


test("local semantic draft inspection identifies exact missing support and accepts its correction", () => {
  const exact = basis([{
    id: "knowledge.beta.current", kind: "knowledge", knowledgeIdentity: "behavior.beta",
    digest: D1, locator: "private://never-display", authorityClass: "repository-authored",
  }]);
  const claim = ["## Claims", "### Claim: claim-beta", "- Category: diagnosis", "- State: observed",
    "- Knowledge: behavior.beta", "- Uncertainty: none", "private-authored-claim-marker", ""].join("\n");
  const invalid = VALID_BUILDER.replace("## Proposal", `${claim}## Proposal`);
  const observed = inspectFoundationSemanticDraftV1({ basis: exact, semanticMarkdown: invalid });
  assert.equal(observed.status, "invalid-result");
  assert.equal(observed.basisDigest, exact.digest);
  assert.deepEqual(observed.diagnostic, {
    code: "lifecycle.agent-work-product.invalid.claim-support", phase: "semantic",
    correction: "correct-semantic-draft", line: null, subject: "behavior.beta",
    localHandle: "claim-beta", expected: ["knowledge.beta.current"],
  });
  assert.doesNotMatch(JSON.stringify(observed), /private-authored-claim-marker|private:\/\//u);
  const durable = validateAgentWorkProductSemanticMarkdown(exact, invalid);
  assert.equal(durable.diagnostic?.localHandle, null);
  assert.equal(durable.diagnostic?.subject, null);
  assert.deepEqual(durable.diagnostic?.expected, []);
  const citation = "## Citations\n### Citation: beta-support\n- Subject: knowledge.beta.current\n- Supports: claim-beta\n";
  const corrected = inspectFoundationSemanticDraftV1({ basis: exact, semanticMarkdown: invalid.replace("## Proposal", `${citation}## Proposal`) });
  assert.equal(corrected.status, "valid-for-checked-scope");
  assert.equal(corrected.basisDigest, observed.basisDigest);
  assert.notEqual(corrected.sourceDigest, observed.sourceDigest);
  assert.equal(corrected.diagnostic, null);
});

test("local semantic draft inspection refuses a substituted basis without echoing it", () => {
  const exact = basis();
  const substituted = { ...exact, parserProfileDigest: D1, secret: "private-basis-marker" };
  const result = inspectFoundationSemanticDraftV1({ basis: substituted, semanticMarkdown: VALID_BUILDER });
  assert.equal(result.status, "runtime-failure");
  assert.equal(result.basisDigest, null);
  assert.deepEqual(result.checked, []);
  assert.doesNotMatch(JSON.stringify(result), /private-basis-marker/u);
  assert.equal(inspectFoundationSemanticDraftV1({ basis: exact, semanticMarkdown: VALID_BUILDER }).status, "valid-for-checked-scope");
});

for (const section of ["Claims", "Citations"] as const) {
  test(`local duplicate ${section} definition identifies its heading and accepts a distinct handle`, () => {
    const exact = basis([{
      id: "knowledge.beta.current", kind: "knowledge", knowledgeIdentity: "behavior.beta",
      digest: D1, locator: "private://never-display", authorityClass: "repository-authored",
    }]);
    const claim = ["### Claim: result", "- Category: diagnosis", "- State: observed", "- Uncertainty: none",
      "private-authored-duplicate-marker", ""].join("\n");
    const second = section === "Claims" ? claim.replace("private-authored-duplicate-marker", "Another bounded diagnosis.")
      : "## Citations\n### Citation: result\n- Subject: knowledge.beta.current\n- Supports: result\n";
    const invalid = VALID_BUILDER.replace("## Proposal", `## Claims\n${claim}${second}## Proposal`);
    const observed = inspectFoundationSemanticDraftV1({ basis: exact, semanticMarkdown: invalid });
    assert.equal(observed.status, "invalid-result");
    assert.equal(observed.basisDigest, exact.digest);
    assert.deepEqual(observed.diagnostic, {
      code: "lifecycle.agent-work-product.invalid.duplicate-local-identity", phase: "semantic",
      correction: "correct-semantic-draft", line: section === "Claims" ? 12 : 13,
      subject: null, localHandle: "result", expected: [],
    });
    assert.match(String(observed.next), /whole semantic\.md/u);
    assert.match(String(observed.next), /update its references/u);
    assert.doesNotMatch(JSON.stringify(observed), /private-authored-duplicate-marker|private:\/\//u);
    const submission = validateAgentWorkProductSemanticMarkdown(exact, invalid);
    assert.equal(submission.diagnostic?.code, "lifecycle.agent-work-product.invalid.duplicate-local-identity");
    assert.equal(submission.diagnostic?.localHandle, null, "Final submission does not expose local correction handles");
    const correctedSecond = section === "Claims" ? second.replace("Claim: result", "Claim: another-result")
      : second.replace("Citation: result", "Citation: cite-result");
    const corrected = inspectFoundationSemanticDraftV1({ basis: exact,
      semanticMarkdown: VALID_BUILDER.replace("## Proposal", `## Claims\n${claim}${correctedSecond}## Proposal`) });
    assert.equal(corrected.status, "valid-for-checked-scope");
    assert.equal(corrected.basisDigest, observed.basisDigest);
    assert.notEqual(corrected.sourceDigest, observed.sourceDigest);
    assert.equal(corrected.diagnostic, null);
  });
}

test("fixed Objective and Mandate handles participate in the same definition namespace", () => {
  for (const heading of ["Objective", "Mandate"] as const) {
    const markdown = ["# Reconnaissance Work Product", "## Outcome", "- Uncertainty: bounded", "A bounded route.",
      "## Claims", `### Claim: ${heading.toLowerCase()}`, "- Category: route", "- State: proposed", "- Uncertainty: bounded",
      "The route remains bounded.", "## Proposal", "- Kind: work-boundary", `### ${heading}`, "A fixed semantic section.", ""].join("\n");
    assert.throws(() => parseAgentWorkProductSemanticMarkdown("reconnaissance", markdown), (error: unknown) => {
      const failure = error as { code: string; observedFacts: unknown };
      assert.equal(failure.code, "lifecycle.agent-work-product.invalid.duplicate-local-identity");
      assert.deepEqual(failure.observedFacts, {
        classification: "invalid-result", phase: "semantic", line: 13, localHandle: heading.toLowerCase(), firstLine: 6,
      });
      return true;
    });
  }
  const builderClaim = "## Claims\n### Claim: mandate\n- Category: diagnosis\n- State: observed\n- Uncertainty: none\nA bounded observation.\n";
  assert.equal(validateAgentWorkProductSemanticMarkdown(basis(), VALID_BUILDER.replace("## Proposal", `${builderClaim}## Proposal`)).status,
    "valid", "A fixed handle is occupied by its definition, not an unrelated reserved-word rule");
});

test("local reference diagnostics distinguish absent definitions from the wrong definition kind", () => {
  const exact = basis([{ id: "evidence.receipt", kind: "evidence", knowledgeIdentity: null,
    digest: D0, locator: "private://never-display", authorityClass: "runtime-observed" }], "reviewer",
  { schema: "lifecycle.proposition-set.v3", propositions: [{ id: "proposition.result" }] });
  const valid = ["# Reviewer Work Product", "## Outcome", "- Disposition: complete", "- Uncertainty: bounded",
    "private-summary-marker", "## Claims", "### Claim: claim-gap", "- Category: limitation", "- State: observed",
    "- Uncertainty: bounded", "private-claim-marker", "## Citations", "### Citation: cite-gap",
    "- Subject: evidence.receipt", "- Supports: claim-gap", "## Limitations", "### Limitation: limit-gap",
    "private-limitation-marker", "## Review", "- Mandate excess: false",
    "### Mandate Applicability: applicability-mandate", "- Disposition: applicable", "- Citation: cite-gap",
    "The original mandate applies.", "### Decision: decision-result", "- Proposition: proposition.result",
    "- Disposition: rejected", "- Citation: cite-gap", "- Uncertainty: bounded", "- Limitation: limit-gap",
    "The existing mandate permits correction of this bounded result.", ""].join("\n");
  for (const change of [
    { from: "- Limitation: limit-gap", to: "- Limitation: claim-gap", handle: "claim-gap", expected: "limitation", actual: "claim" },
    { from: "- Limitation: limit-gap", to: "- Limitation: absent-gap", handle: "absent-gap", expected: "limitation", actual: "absent" },
    { from: "- Citation: cite-gap", to: "- Citation: claim-gap", handle: "claim-gap", expected: "citation", actual: "claim" },
    { from: "- Supports: claim-gap", to: "- Supports: cite-gap", handle: "cite-gap", expected: "claim", actual: "citation" },
  ]) {
    const invalid = valid.replace(change.from, change.to);
    const observed = inspectFoundationSemanticDraftV1({ basis: exact, semanticMarkdown: invalid });
    assert.equal(observed.status, "invalid-result");
    assert.deepEqual(observed.diagnostic, {
      code: "lifecycle.agent-work-product.invalid.local-reference", phase: "semantic",
      correction: "correct-semantic-draft", line: null, subject: null, localHandle: change.handle,
      expected: [`definition-kind:${change.expected}`, `observed-kind:${change.actual}`],
    });
    assert.match(String(observed.next), /A Claim category does not change its definition kind/u);
    assert.doesNotMatch(JSON.stringify(observed), /private-summary-marker|private-claim-marker|private-limitation-marker|private:\/\//u);
    const submission = validateAgentWorkProductSemanticMarkdown(exact, invalid);
    assert.equal(submission.diagnostic?.code, "lifecycle.agent-work-product.invalid.local-reference");
    assert.equal(submission.diagnostic?.localHandle, null);
    assert.deepEqual(submission.diagnostic?.expected, []);
    const corrected = inspectFoundationSemanticDraftV1({ basis: exact, semanticMarkdown: valid });
    assert.equal(corrected.status, "valid-for-checked-scope");
    assert.equal(corrected.basisDigest, observed.basisDigest);
    assert.notEqual(corrected.sourceDigest, observed.sourceDigest);
  }
  const malformed = inspectFoundationSemanticDraftV1({ basis: exact,
    semanticMarkdown: valid.replace("- Limitation: limit-gap", "- Limitation: /private/not-a-handle") });
  assert.equal(malformed.status, "invalid-result");
  assert.equal((malformed.diagnostic as { localHandle: string | null }).localHandle, null);
  assert.doesNotMatch(JSON.stringify(malformed), /private\/not-a-handle/u);
});
