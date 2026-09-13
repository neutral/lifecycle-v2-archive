import type { ControlJsonObject } from "../control/types.js";
import { FoundationError } from "../error.js";
import type { FoundationRepositorySnapshot } from "../repository/types.js";
import { selfDigest, type Sha256 } from "../validation/canonical.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";

/** The immutable pre-Boundary subject, retained before preparation effects. */
export type FoundationPreparationBasisBindingV7 = Readonly<{
  snapshot: FoundationRepositorySnapshot;
  basisDigest: Sha256;
}>;

export function parseFoundationPreparationBasisBindingV7(
  value: ControlJsonObject,
): FoundationPreparationBasisBindingV7 {
  if (Object.keys(value).sort().join("\0") !== ["basisDigest", "snapshot"].join("\0") ||
      typeof value.basisDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.basisDigest)) {
    throw new FoundationError("lifecycle.preparation-context-v7.basis", "Preparation requires its exact retained basis binding");
  }
  assertFoundationSchema("urn:lifecycle:schema:repository-snapshot:v1", value.snapshot, "Preparation Snapshot");
  const snapshot = value.snapshot as unknown as FoundationRepositorySnapshot;
  if (selfDigest(snapshot) !== snapshot.digest) {
    throw new FoundationError("lifecycle.preparation-context-v7.basis", "Preparation Snapshot does not reproduce its exact digest");
  }
  return Object.freeze({ snapshot, basisDigest: value.basisDigest as Sha256 });
}
