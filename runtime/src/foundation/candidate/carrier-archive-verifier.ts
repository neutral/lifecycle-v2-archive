import { FoundationError } from "../error.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordRevision,
} from "../control/types.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { openCandidateRevisionCarrier } from "./carrier-store.js";
import { readFoundationBuilderRepairOutputV1 } from "./repair-output.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
} from "./carrier-types.js";

const MAXIMUM_CANDIDATE_REVISIONS = 25_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const GIT_OBJECT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export type FoundationCandidateCarrierArchiveVerificationV1 = Readonly<{
  candidateRevisionCount: number;
  carrierReferenceSetDigest: Sha256;
}>;

function fail(
  message: string,
  revision?: ControlRecordRevision,
  failureCode?: string,
): never {
  throw new FoundationError(
    "lifecycle.candidate.carrier-archive-verification",
    message,
    {
      observedFacts: revision === undefined
        ? undefined
        : {
            candidate: {
              id: revision.recordId,
              revision: revision.revision,
              digest: revision.digest,
            },
            ...(failureCode === undefined ? {} : { failureCode }),
          },
    },
  );
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} is not one exact object`);
  }
  return value as ControlJsonObject;
}

function candidateRevisions(store: ControlRecordStore, recordKind = "candidate-revision"): readonly ControlRecordRevision[] {
  const current: ControlRecordRevision[] = [];
  let afterRecordId: string | null = null;
  for (;;) {
    const page = store.listCurrentRevisions({
      recordKinds: Object.freeze([recordKind]),
      afterRecordId,
      limit: 1_000,
    });
    current.push(...page);
    if (current.length > MAXIMUM_CANDIDATE_REVISIONS) {
      fail("Candidate record inventory exceeds its Control revision bound");
    }
    if (page.length < 1_000) break;
    afterRecordId = page.at(-1)!.recordId;
  }

  const revisions: ControlRecordRevision[] = [];
  for (const record of current) {
    let afterRevision = 0;
    for (;;) {
      const page = store.listRevisions({
        recordId: record.recordId,
        afterRevision,
        limit: 1_000,
      });
      for (const revision of page) {
        if (revision.recordKind !== recordKind) {
          fail("Carrier-selecting revision inventory contains another Control family", revision);
        }
        revisions.push(revision);
      }
      if (revisions.length > MAXIMUM_CANDIDATE_REVISIONS) {
        fail("Candidate revision inventory exceeds its Control revision bound");
      }
      if (page.length < 1_000) break;
      afterRevision = page.at(-1)!.revision;
    }
  }
  revisions.sort((left, right) => compareCodePoints(
    `${left.recordId}\u0000${left.revision.toString().padStart(16, "0")}`,
    `${right.recordId}\u0000${right.revision.toString().padStart(16, "0")}`,
  ));
  return Object.freeze(revisions);
}

function manifestReference(revision: ControlRecordRevision): Readonly<{
  digest: Sha256;
  byteLength: number;
}> {
  const selected = object(
    revision.payload.carrierManifest,
    "Candidate Revision Carrier manifest reference",
  );
  if (
    canonicalJson(Object.keys(selected).sort()) !== canonicalJson([
      "byteLength",
      "digest",
      "mediaType",
      "purpose",
    ]) ||
    typeof selected.digest !== "string" || !SHA256_PATTERN.test(selected.digest) ||
    !Number.isSafeInteger(selected.byteLength) || (selected.byteLength as number) < 1 ||
    selected.mediaType !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE ||
    selected.purpose !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE
  ) {
    fail("Candidate Revision does not select one exact Carrier manifest", revision);
  }
  return Object.freeze({
    digest: selected.digest as Sha256,
    byteLength: selected.byteLength as number,
  });
}

/**
 * Reopen and fully verify every immutable Candidate Revision Carrier selected
 * anywhere in the Store, including superseded revisions. This check performs
 * no mutation and is safe to repeat before Closure, sealing, and recovery.
 */
export async function verifyCandidateCarriersForStoreArchive(input: Readonly<{
  machineHome: string;
  store: ControlRecordStore;
}>): Promise<FoundationCandidateCarrierArchiveVerificationV1> {
  const verified: Array<Readonly<{
    candidate: Readonly<{ id: string; revision: number; digest: Sha256 }>;
    manifestFileDigest: Sha256;
    manifestDigest: Sha256;
    artifactDigest: Sha256;
    rootTree: string;
  }>> = [];
  for (const revision of candidateRevisions(input.store)) {
    const reference = manifestReference(revision);
    const state = object(revision.payload.state, "Candidate Revision state");
    if (typeof state.tree !== "string" || !GIT_OBJECT_PATTERN.test(state.tree)) {
      fail("Candidate Revision has no exact retained tree", revision);
    }
    let retained: Awaited<ReturnType<ControlRecordStore["readRetainedFile"]>>;
    try {
      retained = await input.store.readRetainedFile(reference.digest);
    } catch (error) {
      fail(
        "Candidate Revision Carrier manifest bytes could not be reopened",
        revision,
        error instanceof FoundationError ? error.code : undefined,
      );
    }
    if (
      retained === null ||
      retained.descriptor.digest !== reference.digest ||
      retained.descriptor.byteLength !== reference.byteLength ||
      retained.descriptor.mediaType !==
        FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE ||
      retained.descriptor.purpose !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE ||
      retained.bytes.byteLength !== reference.byteLength ||
      sha256Bytes(retained.bytes) !== reference.digest
    ) {
      fail("Candidate Revision Carrier manifest bytes are unavailable or substituted", revision);
    }
    let opened: Awaited<ReturnType<typeof openCandidateRevisionCarrier>>;
    try {
      opened = await openCandidateRevisionCarrier({
        machineHome: input.machineHome,
        manifestBytes: retained.bytes,
      });
    } catch (error) {
      fail(
        "Candidate Revision Carrier artifact could not be fully verified",
        revision,
        error instanceof FoundationError ? error.code : undefined,
      );
    }
    if (
      sha256Bytes(opened.manifestBytes) !== reference.digest ||
      opened.manifest.rootTree !== state.tree
    ) {
      fail("Candidate Revision Carrier does not bind its exact retained tree", revision);
    }
    verified.push(Object.freeze({
      candidate: Object.freeze({
        id: revision.recordId,
        revision: revision.revision,
        digest: revision.digest,
      }),
      manifestFileDigest: reference.digest,
      manifestDigest: opened.manifest.digest,
      artifactDigest: opened.manifest.carrierArtifact.digest,
      rootTree: opened.manifest.rootTree,
    }));
  }
  const repairs = [];
  for (const receipt of candidateRevisions(input.store, "execution-receipt")) {
    const repair = await readFoundationBuilderRepairOutputV1({ store: input.store, receipt });
    if (repair === null) continue;
    const opened = await openCandidateRevisionCarrier({ machineHome: input.machineHome, manifestBytes: repair.manifestBytes });
    if (opened.manifest.rootTree !== repair.descriptor.rejection.candidateTree) fail("Retained repair Carrier does not reproduce its exact rejected tree", receipt);
    repairs.push(Object.freeze({ receipt: { id: receipt.recordId, revision: receipt.revision, digest: receipt.digest },
      descriptorDigest: repair.descriptor.digest, manifestFileDigest: repair.descriptor.carrierManifest.digest,
      manifestDigest: opened.manifest.digest, artifactDigest: opened.manifest.carrierArtifact.digest, rootTree: opened.manifest.rootTree }));
  }
  return Object.freeze({
    candidateRevisionCount: verified.length,
    carrierReferenceSetDigest: digestCanonical({
      schema: "lifecycle.candidate-carrier-archive-verification-set.private.v1",
      candidates: Object.freeze(verified),
      repairs: Object.freeze(repairs),
    }),
  });
}
