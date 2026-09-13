import { deliveryGitContextFixture } from "../helpers/delivery-git-context-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";
import { compileCandidateRevisionCarrierManifest } from "../../src/foundation/candidate/carrier-manifest.js";
import { FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1 } from "../../src/foundation/candidate/carrier-types.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  compileFoundationExecutionInputSet,
  parseFoundationExecutionInputSet,
  type FoundationExecutionInputEntryPlanV1,
  type FoundationExecutionInputEntryV1,
  type FoundationExecutionInputResolverV1,
  type FoundationExecutionInputSetCompilationV1,
  type FoundationExecutionInputSetOwnerV1,
  type FoundationExecutionInputSetV1,
  type FoundationExecutionInputSubjectKindV1,
  type FoundationExecutionInputSubjectV1,
  type FoundationVerifiedExecutionInputSubjectV1,
} from "../../src/foundation/execution/input-set.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";

const RUNNER_DIGEST = digest("runner-contract");

const AGENT_KINDS = Object.freeze([
  "projection",
  "role-subject",
  "director-direction",
  "role-brief",
  "semantic-template",
  "capability-profile",
  "provider-descriptor",
  "investment",
  "policy",
  "runner",
] as const);

type MutableEntry = {
  -readonly [Key in keyof FoundationExecutionInputEntryV1]: FoundationExecutionInputEntryV1[Key];
};

type MutableInputSet = {
  -readonly [Key in keyof FoundationExecutionInputSetV1]:
    Key extends "subjects" ? FoundationExecutionInputSubjectV1[]
      : Key extends "entries" ? MutableEntry[]
        : FoundationExecutionInputSetV1[Key];
};

type ResolverState = {
  subjectProofs: Map<Sha256, FoundationVerifiedExecutionInputSubjectV1>;
  entryBytes: Map<string, Uint8Array>;
};

type Fixture = Readonly<{
  compilation: FoundationExecutionInputSetCompilationV1;
  state: ResolverState;
  candidateManifestDigest: Sha256 | null;
  candidateRevisionDigest: Sha256 | null;
}>;

function digest(label: string): Sha256 {
  return sha256Bytes(Buffer.from(label, "utf8"));
}

function bytes(label: string): Uint8Array {
  return Buffer.from(`bytes:${label}`, "utf8");
}

function logicalSubject(
  kind: FoundationExecutionInputSubjectKindV1,
  selectedDigest = kind === "runner" ? RUNNER_DIGEST : digest(`subject:${kind}`),
): FoundationExecutionInputSubjectV1 {
  return Object.freeze({
    kind,
    id: `${kind}-id`,
    revision: 1,
    digest: selectedDigest,
  });
}

function subjectProof(
  subject: FoundationExecutionInputSubjectV1,
  subjectBytes = bytes(subject.kind),
  candidateBinding: FoundationVerifiedExecutionInputSubjectV1["candidateBinding"] = null,
): FoundationVerifiedExecutionInputSubjectV1 {
  const immutableBytes = Uint8Array.from(subjectBytes);
  return Object.freeze({
    subject,
    immutable: true,
    byteLength: immutableBytes.byteLength,
    bytesDigest: sha256Bytes(immutableBytes),
    bytes: immutableBytes,
    candidateBinding,
  });
}

function resolver(state: ResolverState): FoundationExecutionInputResolverV1 {
  return Object.freeze({
    async verifySubject(subject) {
      const proof = state.subjectProofs.get(subject.digest);
      if (proof === undefined) throw new Error("subject unavailable");
      return proof;
    },
    async verifyEntry(plan) {
      const selected = state.entryBytes.get(plan.path);
      if (selected === undefined) throw new Error("entry unavailable");
      const exact = Uint8Array.from(selected);
      return Object.freeze({
        descriptor: Object.freeze({
          ...plan,
          byteLength: exact.byteLength,
          digest: sha256Bytes(exact),
        }),
        immutable: true,
        bytes: exact,
      });
    },
  });
}

function entryPlan(
  path: string,
  purpose: FoundationExecutionInputEntryPlanV1["purpose"],
  source: FoundationExecutionInputSubjectV1,
): FoundationExecutionInputEntryPlanV1 {
  return Object.freeze({
    path,
    purpose,
    mediaType: "application/octet-stream",
    modeClass: "regular",
    sourceSubjectDigest: source.digest,
  });
}

function candidateSubjects(state: ResolverState): Readonly<{
  subjects: readonly FoundationExecutionInputSubjectV1[];
  artifact: FoundationExecutionInputEntryPlanV1;
  manifestDigest: Sha256;
  revisionDigest: Sha256;
}> {
  const artifactBytes = bytes("candidate-carrier-artifact");
  const rootTree = "a".repeat(40);
  const compiled = compileCandidateRevisionCarrierManifest({
    objectFormat: "sha1",
    rootTree,
    objectInventory: Object.freeze([Object.freeze({
      objectId: rootTree,
      objectType: "tree" as const,
      byteLength: 36,
    })]),
    carrierArtifact: Object.freeze({
      format: "git-pack-v2",
      byteLength: artifactBytes.byteLength,
      digest: sha256Bytes(artifactBytes),
    }),
    limits: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  });
  const manifest = logicalSubject(
    "candidate-revision-carrier-manifest",
    sha256Bytes(compiled.manifestBytes),
  );
  const revision = logicalSubject("candidate-revision");
  state.subjectProofs.set(
    manifest.digest,
    subjectProof(manifest, compiled.manifestBytes),
  );
  state.subjectProofs.set(
    revision.digest,
    subjectProof(revision, Buffer.from(`${canonicalJson({ processId: "test-delivery" })}\n`), Object.freeze({
      carrierManifestFileDigest: manifest.digest,
      rootTree,
    })),
  );
  state.entryBytes.set("candidate/carrier.pack", artifactBytes);
  return Object.freeze({
    subjects: Object.freeze([manifest, revision]),
    artifact: entryPlan(
      "candidate/carrier.pack",
      "candidate-carrier-artifact",
      manifest,
    ),
    manifestDigest: manifest.digest,
    revisionDigest: revision.digest,
  });
}

function productBaseSubjects(
  state: ResolverState,
  proofSubjectDigest: Sha256,
): Readonly<{
  subjects: readonly FoundationExecutionInputSubjectV1[];
  artifact: FoundationExecutionInputEntryPlanV1;
}> {
  const artifactBytes = bytes("product-base-object-closure");
  const tree = "b".repeat(40);
  const productBaseValue = Object.freeze({
    schema: "lifecycle.check-product-base.v1",
    proofSubjectDigest,
    objectFormat: "sha1",
    commit: "a".repeat(40),
    tree,
  });
  const productBaseBytes = Buffer.from(`${canonicalJson(productBaseValue)}\n`, "utf8");
  const productBase = logicalSubject("product-base", sha256Bytes(productBaseBytes));
  const manifestSubject = Object.freeze({
    schema: "lifecycle.check-product-base-object-closure.v1",
    productBaseDigest: productBase.digest,
    objectFormat: "sha1",
    baseCommit: productBaseValue.commit,
    rootTree: tree,
    allowedTreeModes: Object.freeze(["040000", "100644", "100755"]),
    objectInventory: Object.freeze([Object.freeze({
      objectId: tree,
      objectType: "tree",
      byteLength: 36,
    })]),
    objectCount: 1,
    aggregateObjectBytes: 36,
    objectInventoryDigest: digestCanonical(Object.freeze([Object.freeze({
      objectId: tree,
      objectType: "tree",
      byteLength: 36,
    })])),
    artifact: Object.freeze({
      format: "git-pack-v2",
      byteLength: artifactBytes.byteLength,
      digest: sha256Bytes(artifactBytes),
    }),
  });
  const manifestValue = Object.freeze({
    ...manifestSubject,
    digest: selfDigest(manifestSubject),
  });
  const manifestBytes = Buffer.from(`${canonicalJson(manifestValue)}\n`, "utf8");
  const manifest = logicalSubject(
    "product-base-object-closure-manifest",
    sha256Bytes(manifestBytes),
  );
  state.subjectProofs.set(productBase.digest, subjectProof(productBase, productBaseBytes));
  state.subjectProofs.set(manifest.digest, subjectProof(manifest, manifestBytes));
  state.entryBytes.set("product-base/object-closure.pack", artifactBytes);
  return Object.freeze({
    subjects: Object.freeze([productBase, manifest]),
    artifact: entryPlan(
      "product-base/object-closure.pack",
      "product-base-object-closure-artifact",
      manifest,
    ),
  });
}

function fixture(
  ownerKind: "reconnaissance" | "resolution" | "builder" | "reviewer" | "check",
  checkPhase: "baseline" | "final" = "final",
): Fixture {
  const state: ResolverState = {
    subjectProofs: new Map(),
    entryBytes: new Map(),
  };
  const subjects: FoundationExecutionInputSubjectV1[] = [];
  const entries: FoundationExecutionInputEntryPlanV1[] = [];
  let owner: FoundationExecutionInputSetOwnerV1;

  if (ownerKind === "check") {
    for (const kind of [
      "check-definition",
      "check-binding",
      "check-proof-subject",
      "runner",
    ] as const) {
      const subject = logicalSubject(kind);
      subjects.push(subject);
      state.subjectProofs.set(subject.digest, subjectProof(subject));
    }
    const definition = subjects.find(({ kind }) => kind === "check-definition")!;
    const proof = subjects.find(({ kind }) => kind === "check-proof-subject")!;
    entries.push(entryPlan("check/request.json", "check-input", definition));
    state.entryBytes.set("check/request.json", bytes("check-request"));
    owner = Object.freeze({
      kind: "check",
      activityId: "activity-check",
      selectionId: "selection-check",
      phase: checkPhase,
      ownerSubjectDigest: proof.digest,
    });
  } else {
    for (const kind of AGENT_KINDS) {
      const subject = logicalSubject(kind);
      subjects.push(subject);
      state.subjectProofs.set(subject.digest, subjectProof(subject));
    }
    const projection = subjects.find(({ kind }) => kind === "projection")!;
    const roleBrief = subjects.find(({ kind }) => kind === "role-brief")!;
    const policy = subjects.find(({ kind }) => kind === "policy")!;
    const role = subjects.find(({ kind }) => kind === "role-subject")!;
    // Deliberately noncanonical input order: the compiler owns ordering.
    entries.push(entryPlan("policy/runtime.json", "policy", policy));
    entries.push(entryPlan("brief/role.md", "role-brief", roleBrief));
    entries.push(entryPlan("context/projection.json", "projection", projection));
    state.entryBytes.set("policy/runtime.json", bytes("policy"));
    state.entryBytes.set("brief/role.md", bytes("role-brief"));
    state.entryBytes.set("context/projection.json", bytes("projection"));
    owner = Object.freeze({
      kind: "agent-attempt",
      activityId: `activity-${ownerKind}`,
      attemptId: `attempt-${ownerKind}`,
      role: ownerKind === "resolution" ? "reconnaissance" : ownerKind,
      ownerSubjectDigest: role.digest,
    });
  }

  let manifestDigest: Sha256 | null = null;
  let revisionDigest: Sha256 | null = null;
  if (ownerKind === "check" && checkPhase === "baseline") {
    const proof = subjects.find(({ kind }) => kind === "check-proof-subject")!;
    const productBase = productBaseSubjects(state, proof.digest);
    subjects.push(...productBase.subjects);
    entries.push(productBase.artifact);
  } else if (ownerKind !== "reconnaissance") {
    const candidate = candidateSubjects(state);
    subjects.push(...candidate.subjects);
    entries.push(candidate.artifact);
    manifestDigest = candidate.manifestDigest;
    revisionDigest = candidate.revisionDigest;
    if (ownerKind !== "check") {
      const revision = candidate.subjects.find(({ kind }) => kind === "candidate-revision")!;
      const context = deliveryGitContextFixture({ candidate: { recordId: revision.id, revision: revision.revision!, digest: revision.digest, processId: "test-delivery" }, rootTree: "a".repeat(40) });
      const subject = logicalSubject("delivery-git-context", context.subjectDigest);
      subjects.push(subject);
      state.subjectProofs.set(subject.digest, subjectProof(subject, context.manifestBytes));
      for (const [path, mediaType, content] of [
        ["candidate/git-context.json", "application/json", context.manifestBytes],
        ["candidate/git-context.pack", "application/octet-stream", context.artifactBytes],
      ] as const) {
        entries.push({ ...entryPlan(path, "operation-input", subject), mediaType });
        state.entryBytes.set(path, content);
      }
    }
  }

  // Reverse the subject input to prove compilation owns canonical order.
  subjects.reverse();
  const compilation: FoundationExecutionInputSetCompilationV1 = Object.freeze({
    owner,
    inputMaterialDigest: digest(`input-material:${ownerKind}`),
    subjects: Object.freeze(subjects),
    entries: Object.freeze(entries),
    runnerContractDigest: RUNNER_DIGEST,
    toolInventoryDigest: digest("tool-inventory"),
    resolver: resolver(state),
  });
  return Object.freeze({
    compilation,
    state,
    candidateManifestDigest: manifestDigest,
    candidateRevisionDigest: revisionDigest,
  });
}

function changed(
  value: FoundationExecutionInputSetV1,
  mutate: (subject: MutableInputSet) => void,
): FoundationExecutionInputSetV1 {
  const subject = JSON.parse(canonicalJson(value)) as MutableInputSet;
  mutate(subject);
  const noDigest = subject as unknown as Record<string, unknown>;
  delete noDigest.digest;
  noDigest.digest = selfDigest(noDigest);
  return subject;
}

function inputSetRefusal(suffix: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof FoundationError &&
    error.code === `lifecycle.execution.input-set.${suffix}`;
}

test("Input Set compilation derives an immutable canonical inventory and parsing reopens every byte", async () => {
  const selected = fixture("reconnaissance");
  const compiled = await compileFoundationExecutionInputSet(selected.compilation);

  assert.deepEqual(compiled.entries.map(({ path }) => path), [
    "brief/role.md",
    "context/projection.json",
    "policy/runtime.json",
  ]);
  assert.equal(compiled.entryCount, compiled.entries.length);
  assert.equal(
    compiled.aggregateByteLength,
    compiled.entries.reduce((sum, entry) => sum + entry.byteLength, 0),
  );
  assert.equal(compiled.contentInventoryDigest, digestCanonical(compiled.entries));
  assert.equal(compiled.digest, selfDigest(compiled as unknown as Record<string, unknown>));
  assert.ok(Object.isFrozen(compiled));
  assert.ok(Object.isFrozen(compiled.subjects));
  assert.ok(Object.isFrozen(compiled.entries[0]!));

  const parsed = await parseFoundationExecutionInputSet({
    value: JSON.parse(canonicalJson(compiled)),
    resolver: selected.compilation.resolver,
  });
  assert.deepEqual(parsed, compiled);
});

test("parsing rejects re-digested derived-field and ordering substitutions", async () => {
  const selected = fixture("reconnaissance");
  const compiled = await compileFoundationExecutionInputSet(selected.compilation);

  const cases: readonly Readonly<{
    value: FoundationExecutionInputSetV1;
    code: string;
  }>[] = [
    {
      value: Object.freeze({ ...compiled, digest: digest("wrong-self-digest") }),
      code: "digest",
    },
    {
      value: changed(compiled, (subject) => { subject.entryCount += 1; }),
      code: "entry-count",
    },
    {
      value: changed(compiled, (subject) => { subject.aggregateByteLength += 1; }),
      code: "aggregate",
    },
    {
      value: changed(compiled, (subject) => {
        subject.contentInventoryDigest = digest("wrong-inventory");
      }),
      code: "inventory-digest",
    },
    {
      value: changed(compiled, (subject) => { subject.entries.reverse(); }),
      code: "entry-order",
    },
    {
      value: changed(compiled, (subject) => { subject.subjects.reverse(); }),
      code: "subject-order",
    },
  ];
  for (const selectedCase of cases) {
    await assert.rejects(
      parseFoundationExecutionInputSet({
        value: selectedCase.value,
        resolver: selected.compilation.resolver,
      }),
      inputSetRefusal(selectedCase.code),
    );
  }
});

test("compilation rejects duplicate, alias, normalization-alias, and file-prefix paths", async () => {
  for (const paths of [
    ["alias/file", "alias/file"],
    ["Alias/file", "alias/file"],
    ["caf\u00e9/file", "cafe\u0301/file"],
    ["prefix", "prefix/file"],
  ] as const) {
    const selected = fixture("reconnaissance");
    const policy = selected.compilation.subjects.find(({ kind }) => kind === "policy")!;
    for (const path of paths) selected.state.entryBytes.set(path, bytes(path));
    const compilation = Object.freeze({
      ...selected.compilation,
      entries: Object.freeze(paths.map((path) => entryPlan(path, "policy", policy))),
    });
    await assert.rejects(
      compileFoundationExecutionInputSet(compilation),
      (error: unknown) => error instanceof FoundationError &&
        [
          "lifecycle.schema.invalid",
          "lifecycle.execution.input-set.entry-order",
          "lifecycle.execution.input-set.path-alias",
          "lifecycle.execution.input-set.path-prefix",
        ].includes(error.code),
    );
  }
});

test("resolution refuses missing sources and independently detected subject or entry substitution", async () => {
  const unresolved = fixture("reconnaissance");
  const badSource = Object.freeze({
    ...unresolved.compilation,
    entries: Object.freeze([Object.freeze({
      ...unresolved.compilation.entries[0]!,
      sourceSubjectDigest: digest("unresolved-source"),
    })]),
  });
  await assert.rejects(
    compileFoundationExecutionInputSet(badSource),
    inputSetRefusal("entry-source"),
  );

  const selected = fixture("reconnaissance");
  const compiled = await compileFoundationExecutionInputSet(selected.compilation);
  const base = selected.compilation.resolver;
  const substitutedSubject: FoundationExecutionInputResolverV1 = Object.freeze({
    ...base,
    async verifySubject(subject) {
      const proof = await base.verifySubject(subject);
      if (subject.kind !== "projection") return proof;
      return Object.freeze({ ...proof, subject: logicalSubject("projection", digest("substitute")) });
    },
  });
  await assert.rejects(
    parseFoundationExecutionInputSet({ value: compiled, resolver: substitutedSubject }),
    inputSetRefusal("subject-proof"),
  );

  const substitutedEntry: FoundationExecutionInputResolverV1 = Object.freeze({
    ...base,
    async verifyEntry(plan) {
      const proof = await base.verifyEntry(plan);
      if (plan.path !== compiled.entries[0]!.path) return proof;
      return Object.freeze({ ...proof, bytes: bytes("substituted-entry") });
    },
  });
  await assert.rejects(
    parseFoundationExecutionInputSet({ value: compiled, resolver: substitutedEntry }),
    inputSetRefusal("entry-proof"),
  );
});

test("reconnaissance refuses an incomplete Candidate, Carrier and Git context selection", async () => {
  const selected = fixture("reconnaissance");
  const candidate = candidateSubjects(selected.state);
  const withSubjects = Object.freeze({
    ...selected.compilation,
    subjects: Object.freeze([...selected.compilation.subjects, ...candidate.subjects]),
    entries: Object.freeze([...selected.compilation.entries, candidate.artifact]),
  });
  await assert.rejects(
    compileFoundationExecutionInputSet(withSubjects),
    inputSetRefusal("subject-policy"),
  );
});

test("resolution reconnaissance requires its complete selected Candidate input triple", async () => {
  const selected = fixture("resolution");
  const compiled = await compileFoundationExecutionInputSet(selected.compilation);
  assert.equal(compiled.owner.kind, "agent-attempt");
  assert.equal(compiled.owner.kind === "agent-attempt" && compiled.owner.role, "reconnaissance");
  for (const omitted of ["candidate-revision", "candidate-revision-carrier-manifest", "delivery-git-context"]) {
    await assert.rejects(compileFoundationExecutionInputSet({
      ...selected.compilation,
      subjects: selected.compilation.subjects.filter(({ kind }) => kind !== omitted),
    }), inputSetRefusal("subject-policy"));
  }
  await assert.rejects(compileFoundationExecutionInputSet({
    ...selected.compilation,
    entries: selected.compilation.entries.filter(({ purpose }) => purpose !== "candidate-carrier-artifact"),
  }), inputSetRefusal("candidate-policy"));
});

test("builder, reviewer and resolution bind the exact Candidate Revision, manifest, and Carrier artifact", async () => {
  for (const role of ["builder", "reviewer", "resolution"] as const) {
    const selected = fixture(role);
    const compiled = await compileFoundationExecutionInputSet(selected.compilation);
    assert.equal(
      compiled.entries.filter(({ purpose }) => purpose === "candidate-carrier-artifact").length,
      1,
    );
    await parseFoundationExecutionInputSet({
      value: compiled,
      resolver: selected.compilation.resolver,
    });

    const base = selected.compilation.resolver;
    const wrongRevisionBinding: FoundationExecutionInputResolverV1 = Object.freeze({
      ...base,
      async verifySubject(subject) {
        const proof = await base.verifySubject(subject);
        if (subject.kind !== "candidate-revision") return proof;
        return Object.freeze({
          ...proof,
          candidateBinding: Object.freeze({
            ...proof.candidateBinding!,
            rootTree: "b".repeat(40),
          }),
        });
      },
    });
    await assert.rejects(
      parseFoundationExecutionInputSet({ value: compiled, resolver: wrongRevisionBinding }),
      inputSetRefusal("candidate-binding"),
    );
  }

  const selected = fixture("builder");
  const compiled = await compileFoundationExecutionInputSet(selected.compilation);
  const substituteBytes = bytes("different-candidate-carrier-artifact");
  const substituted = changed(compiled, (subject) => {
    const artifact = subject.entries.find(
      ({ purpose }) => purpose === "candidate-carrier-artifact",
    )!;
    artifact.byteLength = substituteBytes.byteLength;
    artifact.digest = sha256Bytes(substituteBytes);
    subject.aggregateByteLength = subject.entries.reduce(
      (sum, entry) => sum + entry.byteLength,
      0,
    );
    subject.contentInventoryDigest = digestCanonical(subject.entries);
  });
  const base = selected.compilation.resolver;
  const substitutedArtifact: FoundationExecutionInputResolverV1 = Object.freeze({
    ...base,
    async verifyEntry(plan) {
      if (plan.purpose !== "candidate-carrier-artifact") {
        return await base.verifyEntry(plan);
      }
      return Object.freeze({
        descriptor: Object.freeze({
          ...plan,
          byteLength: substituteBytes.byteLength,
          digest: sha256Bytes(substituteBytes),
        }),
        immutable: true,
        bytes: substituteBytes,
      });
    },
  });
  await assert.rejects(
    parseFoundationExecutionInputSet({ value: substituted, resolver: substitutedArtifact }),
    inputSetRefusal("candidate-binding"),
  );
});

test("final Check Input Sets require Candidate and Check subjects while policy remains optional", async () => {
  const selected = fixture("check");
  const compiled = await compileFoundationExecutionInputSet(selected.compilation);
  assert.equal(compiled.subjects.some(({ kind }) => kind === "policy"), false);
  for (const kind of [
    "candidate-revision",
    "candidate-revision-carrier-manifest",
    "check-definition",
    "check-binding",
    "check-proof-subject",
    "runner",
  ] as const) {
    assert.equal(compiled.subjects.filter((subject) => subject.kind === kind).length, 1);
  }

  const policy = logicalSubject("policy");
  selected.state.subjectProofs.set(policy.digest, subjectProof(policy));
  selected.state.entryBytes.set("check/policy.json", bytes("check-policy"));
  const withPolicy = Object.freeze({
    ...selected.compilation,
    subjects: Object.freeze([...selected.compilation.subjects, policy]),
    entries: Object.freeze([
      ...selected.compilation.entries,
      entryPlan("check/policy.json", "policy", policy),
    ]),
  });
  await compileFoundationExecutionInputSet(withPolicy);

  const missingDefinition = Object.freeze({
    ...selected.compilation,
    subjects: Object.freeze(selected.compilation.subjects.filter(
      ({ kind }) => kind !== "check-definition",
    )),
  });
  await assert.rejects(
    compileFoundationExecutionInputSet(missingDefinition),
    inputSetRefusal("subject-policy"),
  );
});

test("baseline Check Input Sets bind product-base closure bytes without inventing Candidate truth", async () => {
  const selected = fixture("check", "baseline");
  const compiled = await compileFoundationExecutionInputSet(selected.compilation);
  assert.equal(compiled.owner.kind, "check");
  assert.equal(compiled.owner.kind === "check" ? compiled.owner.phase : null, "baseline");
  assert.equal(compiled.subjects.some(({ kind }) => kind === "candidate-revision"), false);
  assert.equal(compiled.subjects.some(({ kind }) =>
    kind === "candidate-revision-carrier-manifest"), false);
  assert.equal(compiled.subjects.filter(({ kind }) => kind === "product-base").length, 1);
  assert.equal(compiled.subjects.filter(({ kind }) =>
    kind === "product-base-object-closure-manifest").length, 1);
  assert.equal(compiled.entries.filter(({ purpose }) =>
    purpose === "product-base-object-closure-artifact").length, 1);
  await parseFoundationExecutionInputSet({
    value: compiled,
    resolver: selected.compilation.resolver,
  });

  await assert.rejects(
    compileFoundationExecutionInputSet(Object.freeze({
      ...selected.compilation,
      owner: Object.freeze({ ...selected.compilation.owner, phase: "final" as const }),
    })),
    inputSetRefusal("subject-policy"),
  );
  const base = selected.compilation.resolver;
  const substitutedProductBase: FoundationExecutionInputResolverV1 = Object.freeze({
    ...base,
    async verifySubject(subject) {
      const proof = await base.verifySubject(subject);
      if (subject.kind !== "product-base") return proof;
      const changedBytes = Buffer.from(`${canonicalJson({
        schema: "lifecycle.check-product-base.v1",
        proofSubjectDigest: digest("another-boundary"),
        objectFormat: "sha1",
        commit: "a".repeat(40),
        tree: "b".repeat(40),
      })}\n`, "utf8");
      return Object.freeze({
        ...proof,
        byteLength: changedBytes.byteLength,
        bytesDigest: sha256Bytes(changedBytes),
        bytes: changedBytes,
      });
    },
  });
  await assert.rejects(
    parseFoundationExecutionInputSet({ value: compiled, resolver: substitutedProductBase }),
    inputSetRefusal("product-base-binding"),
  );
});

test("owner, runner, and closed subject-kind bindings reject cross-owner substitution", async () => {
  const selected = fixture("builder");
  await assert.rejects(
    compileFoundationExecutionInputSet(Object.freeze({
      ...selected.compilation,
      subjects: Object.freeze(selected.compilation.subjects.filter(
        ({ kind }) => kind !== "policy",
      )),
    })),
    inputSetRefusal("subject-policy"),
  );
  await assert.rejects(
    compileFoundationExecutionInputSet(Object.freeze({
      ...selected.compilation,
      runnerContractDigest: digest("wrong-runner"),
    })),
    inputSetRefusal("runner-binding"),
  );
  await assert.rejects(
    compileFoundationExecutionInputSet(Object.freeze({
      ...selected.compilation,
      owner: Object.freeze({
        ...selected.compilation.owner,
        ownerSubjectDigest: digest("missing-owner"),
      }),
    })),
    inputSetRefusal("owner-binding"),
  );
  const policy = selected.compilation.subjects.find(({ kind }) => kind === "policy")!;
  await assert.rejects(
    compileFoundationExecutionInputSet(Object.freeze({
      ...selected.compilation,
      owner: Object.freeze({
        ...selected.compilation.owner,
        ownerSubjectDigest: policy.digest,
      }),
    })),
    inputSetRefusal("owner-binding"),
  );

  const checkDefinition = logicalSubject("check-definition");
  selected.state.subjectProofs.set(checkDefinition.digest, subjectProof(checkDefinition));
  await assert.rejects(
    compileFoundationExecutionInputSet(Object.freeze({
      ...selected.compilation,
      subjects: Object.freeze([...selected.compilation.subjects, checkDefinition]),
    })),
    inputSetRefusal("subject-policy"),
  );
});

test("Delivery Git context binds Candidate identity, tree, history bytes, and stable Delivery branch", async (t) => {
  for (const role of ["builder", "resolution"] as const) {
    for (const mutation of ["candidate", "tree", "branch", "history", "missing"] as const) {
      await t.test(`${role}: ${mutation}`, async () => {
        const selected = fixture(role);
        await compileFoundationExecutionInputSet(selected.compilation);
        const contextSubject = selected.compilation.subjects.find(({ kind }) => kind === "delivery-git-context")!;
        const proof = selected.state.subjectProofs.get(contextSubject.digest)!;
        if (mutation === "missing") {
          await assert.rejects(compileFoundationExecutionInputSet({ ...selected.compilation,
            subjects: selected.compilation.subjects.filter(({ kind }) => kind !== "delivery-git-context"),
          }), inputSetRefusal("subject-policy"));
          return;
        }
        if (mutation === "history") {
          selected.state.entryBytes.set("candidate/git-context.pack", bytes("another history"));
          await assert.rejects(compileFoundationExecutionInputSet(selected.compilation), inputSetRefusal("git-context-binding"));
          return;
        }
        const context = JSON.parse(Buffer.from(proof.bytes).toString("utf8")) as Record<string, unknown>;
        if (mutation === "candidate") (context.candidate as Record<string, unknown>).digest = digest("different Candidate");
        if (mutation === "tree") context.rootTree = "c".repeat(40);
        if (mutation === "branch") context.branch = "refs/heads/another-delivery";
        context.digest = selfDigest(context);
        const newBytes = Buffer.from(`${canonicalJson(context)}\n`);
        const nextSubject = { ...contextSubject, digest: sha256Bytes(newBytes) };
        selected.state.subjectProofs.set(nextSubject.digest, subjectProof(nextSubject, newBytes));
        selected.state.entryBytes.set("candidate/git-context.json", newBytes);
        await assert.rejects(compileFoundationExecutionInputSet({ ...selected.compilation,
          subjects: selected.compilation.subjects.map((subject) => subject === contextSubject ? nextSubject : subject),
          entries: selected.compilation.entries.map((entry) => entry.sourceSubjectDigest === contextSubject.digest ? { ...entry, sourceSubjectDigest: nextSubject.digest } : entry),
        }), inputSetRefusal("git-context-binding"));
      });
    }
  }
});
