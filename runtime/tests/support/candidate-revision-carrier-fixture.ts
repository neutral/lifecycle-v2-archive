import type {
  CandidateRevisionState,
  CandidateRevisionCarrierVerifier,
} from "../../src/foundation/control/candidate-revision.js";
import {
  compileCandidateRevisionCarrierManifest,
  parseCandidateRevisionCarrierManifest,
} from "../../src/foundation/candidate/carrier-manifest.js";
import { FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1 } from "../../src/foundation/candidate/carrier-types.js";
import {
  canonicalJson,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";

const TEST_CARRIER_OBSERVER = Object.freeze({
  implementationId: "test-candidate-carrier-observer-v1",
  implementationDigest: sha256Bytes("test-candidate-carrier-observer-v1"),
});

function testCarrierArtifactDigest(
  rootTree: string,
  pathInventoryDigest: Sha256,
): Sha256 {
  return sha256Bytes(canonicalJson({ rootTree, pathInventoryDigest }));
}

/**
 * A production-schema manifest with a deliberately synthetic artifact digest.
 * Physical replay tests use the real Git Carrier compiler and Store instead.
 */
export function testCandidateCarrierManifestBytes(
  rootTree: string,
  pathInventoryDigest: Sha256,
): Uint8Array {
  const objectFormat = rootTree.length === 40 ? "sha1" : "sha256";
  return compileCandidateRevisionCarrierManifest({
    objectFormat,
    rootTree,
    objectInventory: Object.freeze([Object.freeze({
      objectId: rootTree,
      objectType: "tree" as const,
      byteLength: 36,
    })]),
    carrierArtifact: Object.freeze({
      format: "git-pack-v2",
      byteLength: 1,
      digest: testCarrierArtifactDigest(rootTree, pathInventoryDigest),
    }),
    limits: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  }).manifestBytes;
}

/**
 * Test-only verifier over an explicitly selected complete state.
 * Tests that exercise physical replay use the real Carrier observer instead.
 */
export function testCandidateCarrierVerifier(
  state: CandidateRevisionState,
): CandidateRevisionCarrierVerifier {
  return async (input) => {
    const manifest = parseCandidateRevisionCarrierManifest(
      input.manifestBytes,
      FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    );
    if (
      manifest.rootTree !== state.tree ||
      manifest.carrierArtifact.digest !==
        testCarrierArtifactDigest(state.tree, state.pathInventoryDigest)
    ) {
      throw new Error("Test Candidate Carrier does not bind its explicitly selected state");
    }
    return Object.freeze({
      manifestFileDigest: sha256Bytes(input.manifestBytes),
      state: Object.freeze({ ...state }),
      observer: TEST_CARRIER_OBSERVER,
    });
  };
}

export async function publishTestCandidateCarrier(
  input: Readonly<{ rootTree: string; pathInventoryDigest: Sha256 }>,
): Promise<Readonly<{ manifestBytes: Uint8Array }>> {
  return Object.freeze({
    manifestBytes: testCandidateCarrierManifestBytes(
      input.rootTree,
      input.pathInventoryDigest,
    ),
  });
}
