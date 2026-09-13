import { FOUNDATION_LOCAL_DRAFT_PROFILE } from "./limits.js";
import {
  parseAgentWorkProductValidationBasis,
  FOUNDATION_AGENT_WORK_PRODUCT_LOCAL_HANDLE_GUIDANCE,
  validateAgentWorkProductSemanticMarkdown,
  type AgentWorkProductValidationBasis,
} from "../control/agent-work-product-semantics.js";
import { sha256Bytes } from "../validation/canonical.js";

/** Pure local observation; the caller owns bounded file selection and UTF-8. */
export function inspectFoundationSemanticDraftV1(input: Readonly<{
  basis: unknown;
  semanticMarkdown: string;
}>): Readonly<Record<string, unknown>> {
  let basis: AgentWorkProductValidationBasis | null = null;
  try { basis = parseAgentWorkProductValidationBasis(input.basis); } catch {
    // The shared validator below classifies and projects the exact basis failure.
  }
  const outcome = validateAgentWorkProductSemanticMarkdown(input.basis, input.semanticMarkdown, "local-draft");
  const claimSupport = outcome.diagnostic?.code === "lifecycle.agent-work-product.invalid.claim-support";
  const duplicateHandle = outcome.diagnostic?.code === "lifecycle.agent-work-product.invalid.duplicate-local-identity";
  const localReference = outcome.diagnostic?.code === "lifecycle.agent-work-product.invalid.local-reference" &&
    outcome.diagnostic.localHandle !== null;
  const next = outcome.status === "valid"
    ? "The observed draft satisfies this installed parser and semantic compiler against the supplied basis. Continue authoring or submit normally; Runtime independently validates the final collected bytes and exact Attempt bindings."
    : outcome.status === "runtime-failure"
      ? "Stop this preflight and obtain the exact Runtime-supplied basis for this Attempt and installed authoring profiles. Do not manufacture a replacement basis or treat this result as a draft correction."
      : claimSupport
        ? "For the named Claim, add a Citation whose Subject is one of the matching expected citation handles and whose Supports includes that Claim's local handle. If no matching handle is available, correct the unsupported Knowledge/Evidence assertion or report the missing input; do not invent a citation. Then inspect the revised draft again."
        : duplicateHandle
          ? `Find the other definition of the reported handle across all sections. At the reported line, give the duplicate definition a distinct unused handle and update its references, then inspect the revised draft again. ${FOUNDATION_AGENT_WORK_PRODUCT_LOCAL_HANDLE_GUIDANCE}`
          : localReference
            ? "The reported local handle must name an existing definition of the required kind. The expected hints name the required definition-kind and the observed-kind, or absent. A Claim category does not change its definition kind. Correct the reference or define the required object with a distinct unused handle, then inspect the revised draft again."
          : "Use lifecycle draft forms for the supplied basis role, correct the reported syntax or semantic requirement, and inspect the revised draft again. No local verdict changes the retained Attempt or authorizes an effect.";
  return Object.freeze({
    kind: "semantic-draft",
    profile: FOUNDATION_LOCAL_DRAFT_PROFILE,
    authority: "advisory-local-observation",
    status: outcome.status === "valid" ? "valid-for-checked-scope" : outcome.status,
    sourceDigest: sha256Bytes(Buffer.from(input.semanticMarkdown, "utf8")),
    basisDigest: basis?.digest ?? null,
    role: basis?.role ?? null,
    checked: Object.freeze(basis === null ? [] : [
      "Exact supplied basis shape, digest, role, template, parser and compiler profile selection.",
      "Observed Markdown syntax, role grammar, local references and shared semantic compilation against supplied citation facts and proposition identities.",
    ]),
    excluded: Object.freeze([
      "Authenticity or currentness of a caller-supplied basis; host inspection does not authenticate its source.",
      "Candidate Knowledge Set validity, retained Control construction, attribution, Evidence, mandate completeness, authority and operation eligibility.",
      "Final Output Carrier integrity, Containment, independent Runtime validation and admission of the submitted result.",
    ]),
    diagnostic: outcome.diagnostic,
    next,
  });
}
