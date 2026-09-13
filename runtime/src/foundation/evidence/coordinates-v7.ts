import { FOUNDATION_RUNTIME_PROTOCOL } from "../constants.js";
import { digestCanonical } from "../validation/canonical.js";

export const FOUNDATION_EVIDENCE_RULE_SET_V7 = Object.freeze({
  id: "lifecycle.evidence-packet-rule-set.foundation-v2",
  digest: digestCanonical(Object.freeze({
    id: "lifecycle.evidence-packet-rule-set.foundation-v2",
    runtimeProtocol: FOUNDATION_RUNTIME_PROTOCOL,
    evidenceProfile: "lifecycle.evidence-packet.foundation-v2",
    controlStore: "lifecycle.control-record-store.v2",
  })),
});

export const FOUNDATION_EVIDENCE_VALIDATOR_V7 = Object.freeze({
  id: "lifecycle-runtime-evidence-validator-v7",
  digest: digestCanonical(Object.freeze({
    id: "lifecycle-runtime-evidence-validator-v7",
    runtimeProtocol: FOUNDATION_RUNTIME_PROTOCOL,
    ruleSetDigest: FOUNDATION_EVIDENCE_RULE_SET_V7.digest,
  })),
});
