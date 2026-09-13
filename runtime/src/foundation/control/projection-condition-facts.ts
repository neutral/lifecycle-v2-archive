import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import type { ControlJsonObject, ControlRecordRelationshipTarget } from "./types.js";

/** Exact event provenance is separate from the compiler's measured closure facts. */
export function foundationProjectionConditionObservedFactsDigestV1(input: Readonly<{
  activityId: string;
  boundary: ControlRecordRelationshipTarget;
  candidate: ControlRecordRelationshipTarget;
  seal: ControlRecordRelationshipTarget | null;
  refusalEvent: Readonly<{ sequence: number; digest: Sha256 }>;
  source: ControlJsonObject;
}>): Sha256 {
  return digestCanonical({ schema: "lifecycle.projection-condition-observed-facts.v1", ...input });
}
