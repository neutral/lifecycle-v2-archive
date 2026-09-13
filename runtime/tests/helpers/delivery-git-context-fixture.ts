import { canonicalJson, digestCanonical, selfDigest, sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { foundationDeliveryGitBranchV1, type FoundationDeliveryGitContextManifestV1 } from "../../src/foundation/repository/delivery-git-context-manifest.js";

/** Input-binding fixture only; physical Git import tests use real retained history. */
export function deliveryGitContextFixture(input: Readonly<{
  candidate: Readonly<{ recordId: string; revision: number; digest: Sha256; processId: string }>;
  rootTree: string;
  targetId?: string;
  storeId?: string;
}>) {
  const identity = { targetId: input.targetId ?? "test-target", storeId: input.storeId ?? "test-store", processId: input.candidate.processId };
  const artifactBytes = Buffer.from("exact input-binding Git history fixture\n");
  const tipCommit = (input.rootTree.startsWith("b") ? "c" : "b").repeat(input.rootTree.length);
  const objectInventory = [
    { objectId: input.rootTree, objectType: "tree" as const, byteLength: 36 },
    { objectId: tipCommit, objectType: "commit" as const, byteLength: 200 },
  ].sort((left, right) => left.objectId < right.objectId ? -1 : 1);
  const subject = {
    schema: "lifecycle.delivery-git-context.private.v1" as const, identity,
    candidate: { recordId: input.candidate.recordId, revision: input.candidate.revision, digest: input.candidate.digest },
    branch: foundationDeliveryGitBranchV1(identity), tipCommit, rootTree: input.rootTree,
    objectFormat: input.rootTree.length === 40 ? "sha1" as const : "sha256" as const,
    objectInventory, objectCount: 2, aggregateObjectBytes: 236, objectInventoryDigest: digestCanonical(objectInventory),
    artifact: { format: "git-pack-v2" as const, byteLength: artifactBytes.byteLength, digest: sha256Bytes(artifactBytes) },
  };
  const manifest: FoundationDeliveryGitContextManifestV1 = { ...subject, digest: selfDigest(subject) };
  const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`);
  return { manifest, manifestBytes, artifactBytes, subjectDigest: sha256Bytes(manifestBytes) };
}
