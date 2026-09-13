import { contextInspectionSelection } from "../support/inspection-selection.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  FoundationDeliveryGenerationSchema,
  FoundationKnowledgeIndexSelectorSchema,
  FoundationKnowledgeRecordSelectorSchema,
  type FoundationDeliveryState,
} from "@neutral/lifecycle-protocol";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import { FoundationError } from "../../src/foundation/error.js";
import type {
  FoundationKnowledgeRecord,
  FoundationKnowledgeSet,
} from "../../src/foundation/knowledge/types.js";
import { compileFoundationContextBasis } from "../../src/foundation/read-model/context-basis.js";
import { compileFoundationContextInspection } from
  "../../src/foundation/read-model/context-inspection-runtime.js";
import type { FoundationDeliveryQueryBasis } from "../../src/foundation/read-model/delivery-query-basis.js";
import {
  compileFoundationKnowledgeIndex,
  compileFoundationKnowledgeRecord,
  resolveFoundationKnowledgeInspectionSource,
} from "../../src/foundation/read-model/knowledge-inspection.js";
import {
  compileFoundationSourceRange,
  compileFoundationSourceReference,
} from "../../src/foundation/read-model/source-inspection.js";
import type { FoundationLoadedRepositorySnapshot } from "../../src/foundation/repository/types.js";
import { selfDigest, sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const PROCESS = "context-inspection-process";

function digest(label: string): Sha256 {
  return sha256Bytes(`context-inspection:${label}`);
}

function record(id: string, title: string, body: string): FoundationKnowledgeRecord {
  return Object.freeze({
    path: `records/behavior/${id.slice("behavior.".length)}.md`,
    mode: "100644",
    objectId: "c".repeat(40),
    sourceText: body,
    body,
    bodyNormalized: body,
    headings: Object.freeze([]),
    frontMatter: Object.freeze({
      schema: "lifecycle.knowledge-record.v2",
      kind: "behavior",
      id,
      title,
      status: "current",
      revision: 1,
      supersedes: null,
      summary: `${title} summary.`,
      owners: Object.freeze(["team.foundation"]),
      sources: Object.freeze([]),
      relationships: Object.freeze([]),
      conflicts: Object.freeze([]),
      tags: Object.freeze(["foundation"]),
      spec: Object.freeze({
        outcome: `${title} outcome.`,
        actors: Object.freeze(["Director"]),
        conditions: Object.freeze([]),
        included: Object.freeze(["Exact inspection"]),
        excluded: Object.freeze([]),
        examples: Object.freeze([]),
        falsifiers: Object.freeze(["Another subject is returned"]),
      }),
      extensions: Object.freeze({}),
      canonicalValue: Object.freeze({}),
    }),
    sourceDigest: sha256Bytes(body),
    semanticDigest: digest(`${id}:semantic`),
  });
}

function fixture(): Readonly<{
  query: FoundationDeliveryQueryBasis;
  generation: ReturnType<typeof FoundationDeliveryGenerationSchema.parse>;
}> {
  const records = Object.freeze([
    record("behavior.alpha", "Alpha", "# Alpha\n\ncafé\n"),
    record("behavior.beta", "Beta", "# Beta\n\nSecond.\n"),
  ]);
  const byIdentityRevision = new Map(records.map((value) => [
    `${value.frontMatter.id}@${value.frontMatter.revision}`,
    value,
  ]));
  const knowledge = Object.freeze({
    records,
    currentRecords: records,
    historicalRecords: Object.freeze([]),
    relationships: Object.freeze([]),
    coverage: Object.freeze([]),
    exemptions: Object.freeze([]),
    bindings: Object.freeze([]),
    sources: Object.freeze([]),
    conflicts: Object.freeze([]),
    manifest: Object.freeze({ digest: digest("knowledge") }),
    index: Object.freeze({
      byIdentityRevision,
      revisionsByIdentity: new Map(),
      currentByIdentity: new Map(records.map((value) => [value.frontMatter.id, value])),
      outgoingByIdentity: new Map(),
      incomingByIdentity: new Map(),
      coverageByPath: new Map(),
      coveredPathsByDescription: new Map(),
      bindingsByCheck: new Map(),
      sourcesByIdentityRevision: new Map(),
    }),
  }) as unknown as FoundationKnowledgeSet;
  const basis = Object.freeze({
    specificationRevision: "lifecycle.foundation.1.0.0-rc.17" as const,
    repositoryContract: "lifecycle.repository.v22" as const,
    providerAdapter: "lifecycle.provider-adapter.v7" as const,
    productBaseCommit: COMMIT,
    productBaseTree: TREE,
    productStateDigest: digest("product"),
    atlasStateDigest: digest("atlas-state"),
    atlasResolutionDigest: digest("atlas-resolution"),
    atlasNormalizedModelDigest: digest("atlas-model"),
    atlasResourceBindingsDigest: digest("atlas-resources"),
    repositoryContractDigest: digest("contract"),
    knowledgeSetDigest: digest("knowledge"),
    repositorySnapshotDigest: digest("snapshot"),
  });
  const boundary = compileControlRecordRevision(PROCESS, {
    recordId: "boundary-context-inspection",
    recordKind: "work-boundary",
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthority: "runtime-derived",
    createdAt: "2026-09-04T12:00:00.000Z",
    semanticMarkdown: "# Boundary\n",
    payload: Object.freeze({
      schema: "lifecycle.work-boundary-payload.v6",
      profileId: "lifecycle.work-boundary.foundation-v3",
      basis,
      knowledge: Object.freeze([Object.freeze({
        id: records[0]!.frontMatter.id,
        revision: 1,
        sourceDigest: records[0]!.sourceDigest,
        semanticDigest: records[0]!.semanticDigest,
      })]),
    }),
  });
  const repository = Object.freeze({
    contract: Object.freeze({ targetId: "target-context-inspection", checkBindings: Object.freeze({}) }),
  }) as unknown as FoundationLoadedRepositorySnapshot;
  const generationSubject = Object.freeze({
    schema: "lifecycle.delivery-generation.v1" as const,
    storeId: "store-context-inspection",
    processId: PROCESS,
    journal: Object.freeze({ eventCount: 1, headSequence: 1, headDigest: digest("head") }),
    storeDisposition: Object.freeze({
      stage: "active" as const,
      integrity: "verified" as const,
      sealSubjectDigest: null,
      archiveManifestDigest: null,
    }),
    repository: Object.freeze({
      headCommit: COMMIT,
      headTree: TREE,
      repositoryContractDigest: basis.repositoryContractDigest,
    }),
    activeOperation: null,
  });
  const generation = FoundationDeliveryGenerationSchema.parse(Object.freeze({
    ...generationSubject,
    digest: selfDigest(generationSubject),
  }));
  return Object.freeze({
    generation,
    query: Object.freeze({
      boundaryRole: "active",
      boundary,
      basis,
      knowledge,
      repository,
    }),
  });
}

test("Knowledge inspection pages exact historical records and reopens only its issued body", () => {
  const { query, generation } = fixture();
  const basis = compileFoundationContextBasis(query, contextInspectionSelection(query, generation));
  const selection = basis.selection;
  const first = compileFoundationKnowledgeIndex({
    query,
    basis,
    selector: FoundationKnowledgeIndexSelectorSchema.parse({
      kind: "knowledge-index",
      context: selection,
      afterCursor: null,
      limit: 1,
    }),
  });
  assert.equal(first.records.length, 1);
  assert.equal(first.records[0]!.reference.id, "behavior.alpha");
  assert.equal(first.records[0]!.selectedByBoundary, true);
  assert.equal(first.nextAfterCursor, first.records[0]!.cursor);

  const second = compileFoundationKnowledgeIndex({
    query,
    basis,
    selector: FoundationKnowledgeIndexSelectorSchema.parse({
      kind: "knowledge-index",
      context: selection,
      afterCursor: first.nextAfterCursor,
      limit: 1,
    }),
  });
  assert.equal(second.records[0]!.reference.id, "behavior.beta");
  assert.equal(second.records[0]!.selectedByBoundary, false);
  assert.equal(second.nextAfterCursor, null);

  const inspected = compileFoundationKnowledgeRecord({
    query,
    basis,
    selector: FoundationKnowledgeRecordSelectorSchema.parse({
      kind: "knowledge-record",
      context: selection,
      reference: first.records[0]!.reference,
    }),
  });
  const content = resolveFoundationKnowledgeInspectionSource({
    query,
    basis,
    reference: inspected.body,
  });
  assert(content !== null);
  const startByte = Buffer.from("# Alpha\n\ncaf", "utf8").byteLength;
  const range = compileFoundationSourceRange({
    basis,
    selector: {
      reference: inspected.body,
      startByte,
      maximumBytes: 4,
    },
    content,
  });
  assert.equal(range.content, "é\n");
  assert.equal(range.nextByte, null);
  assert.throws(() => compileFoundationSourceRange({
    basis,
    selector: {
      reference: inspected.body,
      startByte: startByte + 1,
      maximumBytes: 4,
    },
    content,
  }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.context-inspection.source-range-invalid");
});

test("Source references preserve an exact leading UTF-8 BOM and reject substituted bytes", () => {
  const { query, generation } = fixture();
  const basis = compileFoundationContextBasis(query, contextInspectionSelection(query, generation));
  const content = "\uFEFFexact\n";
  const reference = compileFoundationSourceReference({
    basis,
    sourceKind: "knowledge-body",
    subject: Object.freeze({
      kind: "knowledge-record",
      id: "behavior.alpha",
      revision: 1,
      digest: digest("behavior.alpha:semantic"),
    }),
    label: "Alpha",
    path: "records/behavior/alpha.md",
    mediaType: "markdown",
    content,
  });
  const result = compileFoundationSourceRange({
    basis,
    selector: {
      reference,
      startByte: 0,
      maximumBytes: 16,
    },
    content,
  });
  assert.equal(result.content, content);
  assert.equal(result.byteLength, Buffer.byteLength(content));
  assert.throws(() => compileFoundationSourceRange({
    basis,
    selector: {
      reference,
      startByte: 0,
      maximumBytes: 16,
    },
    content: "exact\n",
  }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.context-inspection.source-content-substituted");
});

test("Source inspection reopens its matching active basis despite an unavailable proposal", async () => {
  const { query, generation } = fixture();
  const basis = compileFoundationContextBasis(query, contextInspectionSelection(query, generation));
  const inspected = compileFoundationKnowledgeRecord({
    query,
    basis,
    selector: FoundationKnowledgeRecordSelectorSchema.parse({
      kind: "knowledge-record",
      context: basis.selection,
      reference: {
        id: "behavior.alpha",
        kind: "behavior",
        status: "current",
        revision: 1,
        path: "records/behavior/alpha.md",
        sourceDigest: sha256Bytes("# Alpha\n\ncafé\n"),
        semanticDigest: digest("behavior.alpha:semantic"),
      },
    }),
  });
  const proposed = Object.freeze({
    kind: "work-boundary" as const,
    id: "boundary-unavailable-proposal",
    revision: 1,
    digest: digest("unavailable-proposal"),
  });
  const active = basis.selection.boundary.reference;
  const state = Object.freeze({
    subjects: Object.freeze({
      integrationAssessment: null,
      proposedBoundary: proposed,
      activeBoundary: active,
      candidate: null,
      materialCondition: null,
      seal: null,
      evidence: null,
      closure: null,
    }),
  }) as unknown as FoundationDeliveryState;
  const attempted: string[] = [];
  const result = await compileFoundationContextInspection({
    machineHome: "/private/unused",
    target: "/private/unused",
    store: Object.freeze({}) as unknown as ControlRecordStore,
    state,
    generation,
    selector: {
      kind: "source",
      reference: inspected.body,
      startByte: 0,
      maximumBytes: 4,
    },
    owners: Object.freeze({
      resolveSelection: (_store, selection) => assert.deepEqual(selection, basis.selection),
      compileQueryBasis: async ({ boundary }) => {
        attempted.push(boundary.id);
        if (boundary.id === proposed.id) {
          throw new FoundationError(
            "lifecycle.delivery-query-basis.repository-basis-mismatch",
            "Unrelated proposed basis is unavailable",
          );
        }
        return query;
      },
      loadCurrentSnapshot: async () => {
        throw new TypeError("Source inspection must not load current repository truth");
      },
    }),
  });
  assert.equal(result.kind, "source");
  if (result.kind === "source") assert.equal(result.content, "# Al");
  assert.deepEqual(attempted, [active.id], "The explicit historical selection never probes a newer proposal");
});

test("boundary-bearing no-ship review selects the active historical contract", async () => {
  const { query, generation } = fixture();
  const active = Object.freeze({
    kind: "work-boundary" as const,
    id: query.boundary.recordId,
    revision: query.boundary.revision,
    digest: query.boundary.digest,
  });
  const proposed = Object.freeze({
    kind: "work-boundary" as const,
    id: "boundary-successor",
    revision: 2,
    digest: digest("successor"),
  });
  const state = Object.freeze({
    journal: Object.freeze({ eventCount: 0, headSequence: null, headDigest: null }),
    eligibleOperations: Object.freeze(["delivery.no-ship"]),
    subjects: Object.freeze({
      integrationAssessment: null,
      proposedBoundary: proposed,
      activeBoundary: active,
      candidate: null,
      materialCondition: null,
      seal: null,
      evidence: null,
      closure: null,
    }),
  }) as unknown as FoundationDeliveryState;
  const selected: string[] = [];
  let currentLoads = 0;
  const store = Object.freeze({
    identity: Object.freeze({
      targetId: "target-context-inspection",
      storeId: generation.storeId,
      processId: generation.processId,
    }),
    state: () => state,
    listEvents: () => Object.freeze([]),
  }) as unknown as ControlRecordStore;
  await assert.rejects(() => compileFoundationContextInspection({
    machineHome: "/private/unused",
    target: "/private/unused",
    store,
    state,
    generation,
    selector: {
      kind: "authorization-review",
      expectedGeneration: generation.digest,
      operation: "delivery.no-ship",
      input: { semanticMarkdown: "# No ship\n\nStop this Delivery.\n" },
    },
    owners: Object.freeze({
      compileQueryBasis: async ({ boundary }) => {
        selected.push(boundary.id);
        return query;
      },
      loadCurrentSnapshot: async () => {
        currentLoads += 1;
        throw new TypeError("Boundary-bearing terminal review must not load current HEAD");
      },
    }),
  }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-director-decision.activity");
  assert.deepEqual(selected, [active.id]);
  assert.equal(currentLoads, 0);
});
