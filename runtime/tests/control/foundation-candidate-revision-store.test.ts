import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compileControlRecordFile,
  openControlRecordStore,
} from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlRecordFileInput,
  type ControlRecordRevisionInput,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
} from "../../src/foundation/candidate/carrier-types.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { FoundationError } from "../../src/foundation/error.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import { testCandidateCarrierManifestBytes } from "../support/candidate-revision-carrier-fixture.js";

const CREATED = "2026-08-29T16:00:00.000Z";

function code(expected: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert(error instanceof FoundationError);
    assert.equal(error.code, `lifecycle.control-record-store.${expected}`);
    return true;
  };
}

function candidateAppend(input: Readonly<{
  identity: ControlRecordStoreIdentity;
  file: ControlRecordFileInput;
  suffix: string;
}>): Readonly<{
  descriptor: ReturnType<typeof compileControlRecordFile>;
  append: ControlRecordStoreAppend;
}> {
  const descriptor = compileControlRecordFile(input.file);
  const fixture = validDeliveryControlPayload("candidate-revision");
  const revisionInput: ControlRecordRevisionInput = Object.freeze({
    recordId: `candidate-reference-${input.suffix}`,
    recordKind: "candidate-revision",
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthority: "runtime-observed",
    createdAt: CREATED,
    semanticMarkdown: "# Candidate Revision\n\nBind one exact Carrier manifest.\n",
    payload: Object.freeze({
      ...fixture,
      carrierManifest: Object.freeze({
        digest: descriptor.digest,
        byteLength: descriptor.byteLength,
        mediaType: descriptor.mediaType,
        purpose: descriptor.purpose,
      }),
    }),
    relationships: Object.freeze([Object.freeze({
      relation: "governed-by",
      target: Object.freeze({
        kind: "work-boundary",
        id: "missing-boundary",
        revision: 1,
        digest: sha256Bytes("missing-boundary"),
      }),
    })]),
  });
  const revision = compileControlRecordRevision(input.identity.processId, revisionInput);
  return Object.freeze({
    descriptor,
    append: Object.freeze({
      revision: revisionInput,
      event: Object.freeze({
        eventId: `event-candidate-reference-${input.suffix}`,
        eventKind: "candidate-revision-observed",
        occurredAt: CREATED,
        actor: Object.freeze({ kind: "runtime" as const, id: "foundation-runtime" }),
        subject: Object.freeze({
          recordId: revision.recordId,
          revision: revision.revision,
          digest: revision.digest,
        }),
        payload: Object.freeze({ activityId: `activity-candidate-reference-${input.suffix}` }),
      }),
    }),
  });
}

test("Control Store recognizes the Candidate Revision Carrier manifest as its exact adjacent file", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-candidate-revision-store-"));
  try {
    const identity: ControlRecordStoreIdentity = Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-candidate-reference",
      targetId: "target-candidate-reference",
      processKind: "delivery",
      processId: "delivery-candidate-reference",
      createdAt: CREATED,
    });
    const store = await openControlRecordStore({
      root: join(workspace, "store"),
      identity,
      create: true,
    });
    const fixture = validDeliveryControlPayload("candidate-revision");
    const state = fixture.state as Readonly<{ tree: string; pathInventoryDigest: `sha256:${string}` }>;
    const manifestFile = Object.freeze({
      bytes: testCandidateCarrierManifestBytes(state.tree, state.pathInventoryDigest),
      mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
      purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
      createdAt: CREATED,
    });
    const { append } = candidateAppend({ identity, file: manifestFile, suffix: "valid" });

    const unrelatedFile = Object.freeze({
      bytes: Buffer.from("unrelated adjacent bytes", "utf8"),
      mediaType: "text/plain",
      purpose: "unrelated-adjacent-material",
      createdAt: CREATED,
    });
    await assert.rejects(
      store.appendWithFiles({ files: [unrelatedFile], appends: [append] }),
      code("candidate-carrier-file-required"),
      "the Candidate owner must supply its selected manifest even when another file is supplied",
    );

    await assert.rejects(
      store.appendWithFiles({ files: [manifestFile], appends: [append] }),
      code("relationship-reference"),
      "the bound manifest must pass file selection before the missing relationship refuses",
    );
    assert.deepEqual(store.listRetainedFiles(), [], "failed append must remove its staged manifest");

    const malformedFile = Object.freeze({
      ...manifestFile,
      bytes: Buffer.from('{"schema":"not-a-carrier-manifest"}', "utf8"),
    });
    const malformed = candidateAppend({ identity, file: malformedFile, suffix: "malformed" });
    await assert.rejects(
      store.appendWithFiles({ files: [malformedFile], appends: [malformed.append] }),
      code("candidate-carrier-manifest"),
    );

    const wrongRootFile = Object.freeze({
      ...manifestFile,
      bytes: testCandidateCarrierManifestBytes(
        "c".repeat(state.tree.length),
        state.pathInventoryDigest,
      ),
    });
    const wrongRoot = candidateAppend({ identity, file: wrongRootFile, suffix: "wrong-root" });
    await assert.rejects(
      store.appendWithFiles({ files: [wrongRootFile], appends: [wrongRoot.append] }),
      code("candidate-carrier-subject"),
    );

    assert.throws(
      () => store.append(append),
      code("candidate-carrier-file-required"),
      "a Candidate Revision cannot be retained without its exact adjacent manifest",
    );
    store.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Control Store reserves Candidate Revision Carrier descriptors for Candidate owners", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-candidate-reserved-reference-"));
  try {
    const identity: ControlRecordStoreIdentity = Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-candidate-reserved-reference",
      targetId: "target-candidate-reserved-reference",
      processKind: "delivery",
      processId: "delivery-candidate-reserved-reference",
      createdAt: CREATED,
    });
    const store = await openControlRecordStore({
      root: join(workspace, "store"),
      identity,
      create: true,
    });
    const file = Object.freeze({
      bytes: testCandidateCarrierManifestBytes(
        "b".repeat(40),
        sha256Bytes("reserved-reference-path-inventory"),
      ),
      mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
      purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
      createdAt: CREATED,
    });
    const descriptor = compileControlRecordFile(file);
    const revisionInput: ControlRecordRevisionInput = Object.freeze({
      recordId: "execution-receipt-reserved-candidate-reference",
      recordKind: "execution-receipt",
      revision: 1,
      producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
      semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
      semanticAuthority: "runtime-observed",
      createdAt: CREATED,
      semanticMarkdown: "# Execution Receipt\n",
      payload: Object.freeze({
        ...validDeliveryControlPayload("execution-receipt"),
        rawMaterials: Object.freeze([Object.freeze({
          availability: "retained",
          reference: Object.freeze({
            digest: descriptor.digest,
            byteLength: descriptor.byteLength,
            mediaType: descriptor.mediaType,
            purpose: descriptor.purpose,
          }),
        })]),
      }),
      relationships: Object.freeze([Object.freeze({
        relation: "observes-attempt",
        target: Object.freeze({
          kind: "agent-attempt",
          id: "missing-attempt",
          revision: 1,
          digest: sha256Bytes("missing-attempt"),
        }),
      })]),
    });
    const revision = compileControlRecordRevision(identity.processId, revisionInput);
    const append: ControlRecordStoreAppend = Object.freeze({
      revision: revisionInput,
      event: Object.freeze({
        eventId: "event-execution-receipt-reserved-candidate-reference",
        eventKind: "execution-receipt-recorded",
        occurredAt: CREATED,
        actor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
        subject: Object.freeze({
          recordId: revision.recordId,
          revision: revision.revision,
          digest: revision.digest,
        }),
        payload: Object.freeze({ activityId: "activity-reserved-candidate-reference" }),
      }),
    });

    await assert.rejects(
      store.appendWithFiles({ files: [file], appends: [append] }),
      code("candidate-carrier-reference"),
    );
    assert.deepEqual(store.listRetainedFiles(), []);
    store.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
