import { FoundationError } from "../error.js";
import {
  canonicalRepository,
  exactTreeEntries,
  git,
  resolveGitObjectFormat,
} from "../repository/git.js";
import { canonicalJson } from "../validation/canonical.js";
import {
  candidateRevisionCarrierVerificationParent,
  openCandidateRevisionCarrier,
} from "./carrier-store.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
} from "./carrier-types.js";
import { withVerifiedCandidateRevisionCarrierRepository } from "./git-object-closure.js";

function fail(message: string): never {
  throw new FoundationError("lifecycle.candidate.carrier-import-invalid", message);
}

/**
 * Import one independently verified Candidate Revision Carrier into the target
 * Git object database without creating or moving a ref. The immutable Carrier,
 * rather than a mutable Candidate materialization or a coincidental target
 * object-cache hit, is the source of every imported object.
 */
export async function importCandidateRevisionCarrierIntoRepository(input: Readonly<{
  machineHome: string;
  manifestBytes: Uint8Array;
  repository: string;
  expectedRootTree: string;
}>): Promise<Readonly<{
  rootTree: string;
  manifestFileBytes: Uint8Array;
}>> {
  const repository = await canonicalRepository(input.repository);
  const opened = await openCandidateRevisionCarrier({
    machineHome: input.machineHome,
    manifestBytes: input.manifestBytes,
  });
  if (opened.manifest.rootTree !== input.expectedRootTree) {
    fail("Candidate Carrier root tree differs from the exact retained Candidate Revision");
  }
  const objectFormat = await resolveGitObjectFormat(repository);
  if (opened.manifest.objectFormat !== objectFormat) {
    fail("Candidate Carrier and canonical target use different Git object formats");
  }
  const verificationParent = await candidateRevisionCarrierVerificationParent(input.machineHome);
  await withVerifiedCandidateRevisionCarrierRepository({
    artifactPath: opened.artifactPath,
    manifest: opened.manifest,
    verificationParent,
    limits: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    operation: async (verifiedRepository, closure) => {
      if (closure.rootTree !== input.expectedRootTree || closure.objectFormat !== objectFormat) {
        fail("Candidate Carrier verification selected another immutable Git closure");
      }
      await git(repository, [
        "-c", "maintenance.auto=false",
        "-c", "protocol.file.allow=always",
        "fetch",
        "--force",
        "--no-tags",
        "--no-write-fetch-head",
        "--no-recurse-submodules",
        verifiedRepository,
        closure.rootTree,
      ], { timeoutMs: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1.commandTimeoutMs });
      const importedTree = (await git(repository, [
        "rev-parse", "--verify", "--end-of-options", `${closure.rootTree}^{tree}`,
      ])).stdout.trim();
      if (importedTree !== closure.rootTree) {
        fail("Canonical target did not import the exact Candidate Carrier root tree");
      }
      const importedEntries = await exactTreeEntries(
        repository,
        closure.rootTree,
        closure.objectFormat,
      );
      const expectedEntries = closure.treeEntries.map(({ path, mode, objectId }) =>
        Object.freeze({ path, mode, type: "blob" as const, objectId }));
      if (canonicalJson(importedEntries) !== canonicalJson(expectedEntries)) {
        fail("Canonical target does not reproduce the exact imported Candidate Carrier tree");
      }
    },
  });
  return Object.freeze({
    rootTree: opened.manifest.rootTree,
    manifestFileBytes: Uint8Array.from(opened.manifestBytes),
  });
}
