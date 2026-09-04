import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  FoundationFutureV11AuthorizationReviewResultSchema,
  FoundationFutureV11AuthorizationReviewSelectorSchema,
} from "../src/foundation/future-v11-authorization-review.js";
import { digestFoundationCanonical } from "../src/foundation/core.js";
import {
  gitObject,
  sha,
} from "./future-v11-context-inspection-test-support.js";

type Decision = "admit" | "readmit" | "accept" | "no-ship";
type Operation = "delivery.admit" | "delivery.accept" | "delivery.no-ship";

const consequences = Object.freeze({
  admit: "Establish the selected Work Boundary as the active mandate for this Delivery.",
  readmit:
    "Replace the active Work Boundary with the selected successor and continue the exact retained Candidate.",
  accept:
    "Apply the selected sealed and evidenced Candidate to canonical Product State and close the Delivery.",
  "no-ship": "Close the Delivery without changing canonical Product State.",
} as const);

function semanticDigest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function target(
  kind:
    | "work-boundary"
    | "check-receipt"
    | "material-condition"
    | "candidate-revision"
    | "candidate-seal"
    | "evidence-packet",
  id: string,
  character: string,
  revision = 1,
) {
  return Object.freeze({ kind, id, revision, digest: sha(character) });
}

function selectedControl(decision: Decision, withBoundary = true) {
  if (decision === "admit") {
    return Object.freeze([
      { relation: "selects-baseline-receipt" as const, target: target("check-receipt", "receipt.baseline.one", "1") },
      { relation: "selects-boundary" as const, target: target("work-boundary", "boundary.one", "2") },
    ]);
  }
  if (decision === "readmit") {
    return Object.freeze([
      { relation: "continues-from-boundary" as const, target: target("work-boundary", "boundary.one", "2") },
      { relation: "resolves" as const, target: target("material-condition", "condition.one", "3") },
      { relation: "selects-baseline-receipt" as const, target: target("check-receipt", "receipt.baseline.two", "4") },
      { relation: "selects-boundary" as const, target: target("work-boundary", "boundary.one", "5", 2) },
      { relation: "selects-candidate" as const, target: target("candidate-revision", "candidate.one", "6", 3) },
    ]);
  }
  if (decision === "accept") {
    return Object.freeze([
      { relation: "selects-boundary" as const, target: target("work-boundary", "boundary.one", "2") },
      { relation: "selects-candidate" as const, target: target("candidate-revision", "candidate.one", "6", 3) },
      { relation: "selects-evidence" as const, target: target("evidence-packet", "evidence.one", "7") },
      { relation: "selects-seal" as const, target: target("candidate-seal", "seal.one", "8") },
    ]);
  }
  if (!withBoundary) return Object.freeze([]);
  return Object.freeze([
    { relation: "resolves" as const, target: target("material-condition", "condition.one", "3") },
    { relation: "selects-boundary" as const, target: target("work-boundary", "boundary.one", "2") },
    { relation: "selects-candidate" as const, target: target("candidate-revision", "candidate.one", "6", 3) },
  ]);
}

function review(options: Readonly<{
  decision?: Decision;
  withBoundary?: boolean;
  storeId?: string;
  processId?: string;
  semanticMarkdown?: string;
}> = {}) {
  const decision = options.decision ?? "accept";
  const operation: Operation = decision === "accept"
    ? "delivery.accept"
    : decision === "no-ship" ? "delivery.no-ship" : "delivery.admit";
  const bindings = selectedControl(decision, options.withBoundary);
  const markdown = options.semanticMarkdown ?? (
    decision === "accept"
      ? "# Founder Acceptance Decision\n\nAccept the exact evidenced sealed Candidate selected by this authenticated Decision.\n"
      : decision === "no-ship"
        ? "# No ship\n\nStop this Delivery without changing Product State.\n"
        : "# Founder Admission Decision\n\nAuthorize the exact selected admission Control subjects on the observed repository basis.\n"
  );
  const body = {
    schema: "lifecycle.founder-authorization-review.v1" as const,
    targetId: "target.one",
    storeId: options.storeId ?? "store.one",
    processId: options.processId ?? "delivery.one",
    operation,
    decision,
    consequence: consequences[decision],
    semanticMarkdown: markdown,
    semanticDigest: semanticDigest(markdown),
    journalHead: { sequence: 17, digest: sha("9") },
    reducerFactsDigest: sha("a"),
    repository: {
      repositorySnapshotDigest: sha("b"),
      canonicalCommit: gitObject("3"),
      canonicalTree: gitObject("4"),
      productStateDigest: sha("c"),
      atlasStateDigest: sha("d"),
      atlasResolutionDigest: sha("e"),
      atlasNormalizedModelDigest: sha("f"),
      atlasResourceBindingsDigest: sha("0"),
      repositoryContractDigest: sha("1"),
      knowledgeSetDigest: sha("2"),
      checkBindingSetDigest: sha("3"),
    },
    selectedControl: bindings,
    coordinates: {
      qualification: "lifecycle.foundation.1.0.0-rc.11" as const,
      repository: "lifecycle.repository.v16" as const,
      provider: "lifecycle.provider-adapter.v6" as const,
      authoritySubject: "lifecycle.founder-decision-subject.v3" as const,
      transactionRules: "lifecycle.delivery-transaction-rules.v1" as const,
    },
    authority: {
      principalId: "founder:one",
      keyId: "key.one",
      algorithm: "ed25519" as const,
    },
    candidateDisposition: decision !== "no-ship"
      ? "not-applicable" as const
      : bindings.some(({ relation }) => relation === "selects-candidate")
        ? "abandon" as const
        : "no-candidate" as const,
  };
  return Object.freeze({
    ...body,
    authorizationReviewDigest: digestFoundationCanonical(body),
  });
}

function generation(options: Readonly<{
  storeId?: string;
  processId?: string;
  eventCount?: number;
  headDigest?: ReturnType<typeof sha>;
}> = {}) {
  const eventCount = options.eventCount ?? 17;
  return Object.freeze({
    schema: "lifecycle.delivery-generation.v1" as const,
    storeId: options.storeId ?? "store.one",
    processId: options.processId ?? "delivery.one",
    journal: {
      eventCount,
      headSequence: eventCount,
      headDigest: options.headDigest ?? sha("9"),
    },
    storeDisposition: {
      stage: "active" as const,
      integrity: "verified" as const,
      sealSubjectDigest: null,
      archiveManifestDigest: null,
    },
    // The live checkout is deliberately later than the historical terminal basis.
    repository: {
      headCommit: gitObject("7"),
      headTree: gitObject("8"),
      repositoryContractDigest: sha("1"),
    },
    activeOperation: null,
    digest: sha("4"),
  });
}

function inspection(selectedReview = review(), selectedGeneration = generation()) {
  return Object.freeze({
    schema: "lifecycle.founder-authorization-review-inspection.v1" as const,
    generation: selectedGeneration,
    review: selectedReview,
  });
}

function withReviewDigest(value: ReturnType<typeof review>, changes: Readonly<Record<string, unknown>>) {
  const { authorizationReviewDigest: _digest, ...priorBody } = value;
  const body = { ...priorBody, ...changes };
  return Object.freeze({ ...body, authorizationReviewDigest: digestFoundationCanonical(body) });
}

test("authorization review selector uses a direct generation and only no-ship accepts semantics", () => {
  const direct = {
    kind: "authorization-review",
    expectedGeneration: sha("4"),
    operation: "delivery.accept",
    input: null,
  };
  assert.equal(FoundationFutureV11AuthorizationReviewSelectorSchema.safeParse(direct).success, true);
  assert.equal(FoundationFutureV11AuthorizationReviewSelectorSchema.safeParse({
    ...direct,
    operation: "delivery.admit",
  }).success, true);
  assert.equal(FoundationFutureV11AuthorizationReviewSelectorSchema.safeParse({
    ...direct,
    operation: "delivery.no-ship",
    input: { semanticMarkdown: "# No ship\n\nStop here.\n" },
  }).success, true);
  assert.equal(FoundationFutureV11AuthorizationReviewSelectorSchema.safeParse({
    ...direct,
    context: { boundary: target("work-boundary", "boundary.one", "2") },
  }).success, false);
  assert.equal(FoundationFutureV11AuthorizationReviewSelectorSchema.safeParse({
    ...direct,
    input: { semanticMarkdown: "Not accepted for admission or acceptance." },
  }).success, false);
  assert.equal(FoundationFutureV11AuthorizationReviewSelectorSchema.safeParse({
    ...direct,
    operation: "delivery.no-ship",
  }).success, false);
});

test("authorization review inspection preserves every exact Control binding variant", () => {
  const variants = [
    review({ decision: "admit" }),
    review({ decision: "readmit" }),
    review({ decision: "accept" }),
    review({ decision: "no-ship", withBoundary: true }),
    review({ decision: "no-ship", withBoundary: false }),
  ];
  for (const selected of variants) {
    const parsed = FoundationFutureV11AuthorizationReviewResultSchema.parse(inspection(selected));
    assert.deepEqual(parsed.review.selectedControl, selected.selectedControl);
  }

  const readmission = variants[1]!;
  assert.deepEqual(
    readmission.selectedControl.map(({ relation }) => relation),
    [
      "continues-from-boundary",
      "resolves",
      "selects-baseline-receipt",
      "selects-boundary",
      "selects-candidate",
    ],
  );
  assert.equal(variants[4]!.selectedControl.length, 0);
});

test("authorization review uses its exact core digest and binds every reviewed basis", () => {
  const base = review();
  const { authorizationReviewDigest, ...body } = base;
  assert.equal(authorizationReviewDigest, digestFoundationCanonical(body));

  const variants = [
    withReviewDigest(base, { targetId: "target.two" }),
    withReviewDigest(base, { reducerFactsDigest: sha("5") }),
    withReviewDigest(base, {
      repository: { ...base.repository, productStateDigest: sha("6") },
    }),
    withReviewDigest(base, {
      authority: { ...base.authority, principalId: "founder:two" },
    }),
  ];
  for (const changed of variants) {
    assert.equal(FoundationFutureV11AuthorizationReviewResultSchema.safeParse(
      inspection(changed),
    ).success, true);
    assert.notEqual(changed.authorizationReviewDigest, base.authorizationReviewDigest);
  }

  assert.equal(FoundationFutureV11AuthorizationReviewResultSchema.safeParse(inspection({
    ...base,
    reducerFactsDigest: sha("5"),
  })).success, false);
});

test("authorization review excludes operation mechanics and authority material", () => {
  const base = review();
  for (const forbidden of [
    "activityId",
    "decisionId",
    "authorizedAt",
    "expiresAt",
    "nonce",
    "challenge",
    "signature",
    "subject",
    "subjectDigest",
    "authoritySecret",
  ]) {
    const changed = withReviewDigest(base, { [forbidden]: "forbidden" });
    assert.equal(
      FoundationFutureV11AuthorizationReviewResultSchema.safeParse(inspection(changed)).success,
      false,
      forbidden,
    );
    assert.equal(FoundationFutureV11AuthorizationReviewSelectorSchema.safeParse({
      kind: "authorization-review",
      expectedGeneration: sha("4"),
      operation: "delivery.no-ship",
      input: { semanticMarkdown: "# No ship\n", [forbidden]: "forbidden" },
    }).success, false, `selector ${forbidden}`);
  }
});

test("authorization review rejects binding, semantic, decision, and generation mismatches", () => {
  const accepted = review();
  const cases = [
    inspection(accepted, generation({ storeId: "store.two" })),
    inspection(accepted, generation({ processId: "delivery.two" })),
    inspection(accepted, generation({ eventCount: 18 })),
    inspection(accepted, generation({ headDigest: sha("5") })),
    inspection(withReviewDigest(accepted, { decision: "no-ship" })),
    inspection(withReviewDigest(accepted, { consequence: consequences.admit })),
    inspection(withReviewDigest(accepted, { semanticDigest: sha("5") })),
    inspection(withReviewDigest(accepted, {
      semanticMarkdown: accepted.semanticMarkdown.trimEnd(),
      semanticDigest: semanticDigest(accepted.semanticMarkdown.trimEnd()),
    })),
    inspection(withReviewDigest(accepted, {
      semanticMarkdown: `${accepted.semanticMarkdown}\n`,
      semanticDigest: semanticDigest(`${accepted.semanticMarkdown}\n`),
    })),
    inspection(withReviewDigest(accepted, { selectedControl: accepted.selectedControl.slice(1) })),
    inspection(withReviewDigest(accepted, { selectedControl: [...accepted.selectedControl].reverse() })),
    inspection(withReviewDigest(accepted, {
      selectedControl: [
        ...accepted.selectedControl,
        { relation: "selects-boundary", target: target("work-boundary", "boundary.two", "5") },
      ],
    })),
  ];
  for (const [index, candidate] of cases.entries()) {
    assert.equal(
      FoundationFutureV11AuthorizationReviewResultSchema.safeParse(candidate).success,
      false,
      `mismatch ${index}`,
    );
  }

  const earlyNoShip = review({ decision: "no-ship", withBoundary: false });
  const impossibleEarlySelection = withReviewDigest(earlyNoShip, {
    selectedControl: [
      { relation: "resolves", target: target("material-condition", "condition.one", "3") },
    ],
  });
  assert.equal(
    FoundationFutureV11AuthorizationReviewResultSchema.safeParse(
      inspection(impossibleEarlySelection),
    ).success,
    false,
  );
});
