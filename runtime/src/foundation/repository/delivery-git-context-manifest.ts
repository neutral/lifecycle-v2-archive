import { FoundationError } from "../error.js";
import { canonicalJson, digestCanonical, selfDigest, sha256Bytes, type Sha256 } from "../validation/canonical.js";

export const FOUNDATION_DELIVERY_GIT_CONTEXT_PATHS_V1 = Object.freeze({
  manifest: "candidate/git-context.json",
  artifact: "candidate/git-context.pack",
});
export const FOUNDATION_DELIVERY_GIT_CONTEXT_MAXIMUM_BYTES_V1 = 256 * 1024 * 1024;
export type FoundationDeliveryGitContextManifestV1 = Readonly<{
  schema: "lifecycle.delivery-git-context.private.v1";
  identity: Readonly<{ targetId: string; storeId: string; processId: string }>;
  candidate: Readonly<{ recordId: string; revision: number; digest: Sha256 }>;
  branch: string;
  tipCommit: string;
  rootTree: string;
  objectFormat: "sha1" | "sha256";
  objectInventory: readonly Readonly<{ objectId: string; objectType: "commit" | "tree" | "blob"; byteLength: number }>[];
  objectCount: number;
  aggregateObjectBytes: number;
  objectInventoryDigest: Sha256;
  artifact: Readonly<{ format: "git-pack-v2"; digest: Sha256; byteLength: number }>;
  digest: Sha256;
}>;

export function foundationDeliveryGitBranchV1(identity: FoundationDeliveryGitContextManifestV1["identity"]): string {
  return `refs/heads/lifecycle/delivery/${digestCanonical({ targetId: identity.targetId, storeId: identity.storeId, processId: identity.processId }).slice(7)}`;
}

export function parseFoundationDeliveryGitContextV1(bytes: Uint8Array): FoundationDeliveryGitContextManifestV1 {
  const invalid = (): never => { throw new FoundationError("lifecycle.execution.input-set.git-context-binding", "Delivery Git context is not one exact bounded immutable subject"); };
  if (bytes.byteLength === 0 || bytes.byteLength > FOUNDATION_DELIVERY_GIT_CONTEXT_MAXIMUM_BYTES_V1) invalid();
  let value: FoundationDeliveryGitContextManifestV1;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")) as FoundationDeliveryGitContextManifestV1; } catch { invalid(); }
  const keys = (object: unknown, expected: string[]): boolean => object !== null && typeof object === "object" && !Array.isArray(object) &&
    Object.keys(object).sort().join("\0") === expected.sort().join("\0");
  const digest = (input: unknown): input is Sha256 => typeof input === "string" && /^sha256:[a-f0-9]{64}$/u.test(input);
  if (!keys(value!, ["schema", "identity", "candidate", "branch", "tipCommit", "rootTree", "objectFormat", "objectInventory", "objectCount", "aggregateObjectBytes", "objectInventoryDigest", "artifact", "digest"]) ||
      value!.schema !== "lifecycle.delivery-git-context.private.v1" ||
      !keys(value!.identity, ["targetId", "storeId", "processId"]) ||
      Object.values(value!.identity).some((id) => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u.test(id)) ||
      !keys(value!.candidate, ["recordId", "revision", "digest"]) ||
      typeof value!.candidate.recordId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u.test(value!.candidate.recordId) ||
      !Number.isSafeInteger(value!.candidate.revision) || value!.candidate.revision < 1 || !digest(value!.candidate.digest) ||
      !(value!.objectFormat === "sha1" || value!.objectFormat === "sha256") ||
      value!.branch !== foundationDeliveryGitBranchV1(value!.identity) ||
      !keys(value!.artifact, ["format", "digest", "byteLength"]) || value!.artifact.format !== "git-pack-v2" ||
      !digest(value!.artifact.digest) || !Number.isSafeInteger(value!.artifact.byteLength) || value!.artifact.byteLength < 1 ||
      !Array.isArray(value!.objectInventory) || value!.objectInventory.length < 1 || value!.objectInventory.length > 1_000_000) invalid();
  const selected = value!;
  const oid = new RegExp(selected.objectFormat === "sha1" ? "^[a-f0-9]{40}$" : "^[a-f0-9]{64}$", "u");
  if (!oid.test(selected.tipCommit) || !oid.test(selected.rootTree)) invalid();
  let aggregate = 0;
  for (let index = 0; index < selected.objectInventory.length; index += 1) {
    const entry = selected.objectInventory[index]!;
    if (!keys(entry, ["objectId", "objectType", "byteLength"])) invalid();
    aggregate += entry.byteLength;
    if (typeof entry.objectId !== "string" || !oid.test(entry.objectId) ||
        !["commit", "tree", "blob"].includes(entry.objectType) || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0 ||
        !Number.isSafeInteger(aggregate) || index > 0 && selected.objectInventory[index - 1]!.objectId >= entry.objectId) invalid();
  }
  if (selected.objectCount !== selected.objectInventory.length || selected.aggregateObjectBytes !== aggregate ||
      selected.objectInventoryDigest !== digestCanonical(selected.objectInventory) || selected.digest !== selfDigest(selected) ||
      !selected.objectInventory.some((entry) => entry.objectId === selected.tipCommit && entry.objectType === "commit") ||
      !selected.objectInventory.some((entry) => entry.objectId === selected.rootTree && entry.objectType === "tree") ||
      sha256Bytes(bytes) !== sha256Bytes(`${canonicalJson(selected)}\n`)) invalid();
  return selected;
}
