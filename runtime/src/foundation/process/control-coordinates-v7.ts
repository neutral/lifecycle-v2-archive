import { FOUNDATION_RUNTIME_PROTOCOL } from "../constants.js";
import { digestCanonical } from "../validation/canonical.js";

export { FOUNDATION_EVIDENCE_RULE_SET_V7, FOUNDATION_EVIDENCE_VALIDATOR_V7 } from "../evidence/coordinates-v7.js";

export const FOUNDATION_MATERIAL_CONDITION_RUNTIME_V7 = Object.freeze({
  implementationId: "lifecycle-runtime-material-condition-v7",
  implementationDigest: digestCanonical(Object.freeze({
    id: "lifecycle-runtime-material-condition-v7",
    runtimeProtocol: FOUNDATION_RUNTIME_PROTOCOL,
    sources: Object.freeze(["agent-work-product"]),
  })),
});
