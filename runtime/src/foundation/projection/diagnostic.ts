import { FoundationError } from "../error.js";
import type { Sha256 } from "../validation/canonical.js";

const MAXIMUM_DIAGNOSTIC_CODES = 64;
const MAXIMUM_DIAGNOSTIC_CODE_LENGTH = 128;

// This is a disclosure vocabulary, not a validity registry or error classifier.
// Unknown failures retain the outer diagnostic without exposing caught text.
const PUBLIC_PROJECTION_CODES = new Set([
  "lifecycle.projection.atlas-selection",
  "lifecycle.projection.authority-conflict",
  "lifecycle.projection.basis-mismatch",
  "lifecycle.projection.boundary-invalid",
  "lifecycle.projection.bounds-invalid",
  "lifecycle.projection.cache-stale",
  "lifecycle.projection.check-binding-mismatch",
  "lifecycle.projection.check-binding-missing",
  "lifecycle.projection.citation-identity-conflict",
  "lifecycle.projection.compiler-failure",
  "lifecycle.projection.content-digest",
  "lifecycle.projection.control-invalid",
  "lifecycle.projection.counts-invalid",
  "lifecycle.projection.description-ambiguous",
  "lifecycle.projection.description-missing",
  "lifecycle.projection.discipline-invalid",
  "lifecycle.projection.evidence-invalid",
  "lifecycle.projection.external-denied",
  "lifecycle.projection.index-invalid",
  "lifecycle.projection.knowledge-invalid",
  "lifecycle.projection.mandatory-omission",
  "lifecycle.projection.mandatory-too-large",
  "lifecycle.projection.order-invalid",
  "lifecycle.projection.profile-mismatch",
  "lifecycle.projection.profile-unsupported",
  "lifecycle.projection.request-invalid",
  "lifecycle.projection.reviewer-seal",
  "lifecycle.projection.root-unresolved",
  "lifecycle.projection.source-inaccessible",
  "lifecycle.projection.source-stale",
  "lifecycle.schema.invalid",
]);

export type FoundationProjectionDiagnosticFacts = Readonly<{
  validationDigest: Sha256;
  diagnosticCodes: readonly string[];
}>;

/** Revalidate only the existing context owners' bounded public failure facts. */
export function foundationProjectionDiagnosticFacts(error: unknown): FoundationProjectionDiagnosticFacts | null {
  if (!(error instanceof FoundationError) ||
      (error.code !== "lifecycle.operation-context-v7.projection" &&
        error.code !== "lifecycle.preparation-context-v7.projection")) return null;
  const facts = error.observedFacts;
  if (facts === null || typeof facts !== "object" || Array.isArray(facts)) return null;
  const { validationDigest, diagnostics } = facts as Record<string, unknown>;
  if (typeof validationDigest !== "string" || validationDigest.length !== 71 || !/^sha256:[a-f0-9]{64}$/u.test(validationDigest) ||
      !Array.isArray(diagnostics) || diagnostics.length === 0 || diagnostics.length > MAXIMUM_DIAGNOSTIC_CODES) return null;
  for (const code of diagnostics) {
    if (typeof code !== "string" || code.length > MAXIMUM_DIAGNOSTIC_CODE_LENGTH || !PUBLIC_PROJECTION_CODES.has(code)) return null;
  }
  // Do not truncate, rewrite, deduplicate, or expose any other diagnostic data.
  return Object.freeze({
    validationDigest: validationDigest as Sha256,
    diagnosticCodes: Object.freeze([...diagnostics]),
  });
}
