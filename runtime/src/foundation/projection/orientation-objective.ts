import { FOUNDATION_SEMANTIC_MARKDOWN_MAXIMUM_BYTES } from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";

export const FOUNDATION_ORIENTATION_OBJECTIVE_MAXIMUM_BYTES = FOUNDATION_SEMANTIC_MARKDOWN_MAXIMUM_BYTES;

/** The complete objective is one bounded subject, including Runtime resolution context. */
export function parseOrientationObjective(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new FoundationError("lifecycle.projection.request-invalid", "Orientation objective must be nonempty text without NUL");
  }
  const objective = value;
  const observedBytes = Buffer.byteLength(objective, "utf8");
  if (observedBytes > FOUNDATION_ORIENTATION_OBJECTIVE_MAXIMUM_BYTES) {
    throw new FoundationError("lifecycle.projection.request-invalid", "Orientation objective exceeds its complete UTF-8 byte bound", {
      observedFacts: { observedBytes, maximumBytes: FOUNDATION_ORIENTATION_OBJECTIVE_MAXIMUM_BYTES },
    });
  }
  return objective;
}
