import type { AgentAttemptExecutionPolicy } from "../control/agent-attempt.js";
import { canonicalJson, digestCanonical, type Sha256 } from "../validation/canonical.js";

const EXECUTION_POLICY_KEYS = Object.freeze([
  "cancellationPolicyDigest",
  "containmentPolicyDigest",
  "parentLossPolicyDigest",
  "retirementPolicyDigest",
  "recoveryPolicyDigest",
] as const);

type FoundationInstalledAgentExecutionPolicyKeyV1 =
  typeof EXECUTION_POLICY_KEYS[number];

export type FoundationInstalledAgentExecutionPolicySubjectV1 = Readonly<{
  key: FoundationInstalledAgentExecutionPolicyKeyV1;
  id: string;
  value: Readonly<Record<string, unknown>>;
  digest: Sha256;
  bytes: Uint8Array;
}>;

export type FoundationInstalledAgentExecutionPolicySelectionV1 = Readonly<{
  executionPolicy: AgentAttemptExecutionPolicy;
  subjects: readonly FoundationInstalledAgentExecutionPolicySubjectV1[];
}>;

const FIXED_AGENT_EXECUTION_POLICY_DEFINITIONS_V1 = Object.freeze([
  Object.freeze({
    key: "cancellationPolicyDigest" as const,
    id: "lifecycle.agent-execution-policy.cancellation.v1",
    value: Object.freeze({
      schema: "lifecycle.agent-execution-policy.cancellation.v1",
      request: "contain-cell",
      redispatch: "forbidden",
    }),
  }),
  Object.freeze({
    key: "containmentPolicyDigest" as const,
    id: "lifecycle.agent-execution-policy.containment.v1",
    value: Object.freeze({
      schema: "lifecycle.agent-execution-policy.containment.v1",
      beforeObservation: "required",
      beforeRetirement: "required",
      agentProductNetwork: "none",
      agentToolNetwork: false,
      providerControlPlane: "fixed-service-channel",
      providerControlProtocol: "http-connect-tls-443-only",
      providerControlDestinations: Object.freeze([
        "api.openai.com",
        "auth.openai.com",
        "chatgpt.com",
      ]),
      providerControlMaximumConnections: 16,
      providerControlSeparation: "required",
      credentialMode: "fixed-runner",
      credentialBindingId: "provider-control",
      credentialTransport: "exclusive-execution-snapshot-and-private-provider-state-volume",
      agentCredentialAccess: false,
      credentialOutputDisclosure: false,
    }),
  }),
  Object.freeze({
    key: "parentLossPolicyDigest" as const,
    id: "lifecycle.agent-execution-policy.parent-loss.v1",
    value: Object.freeze({
      schema: "lifecycle.agent-execution-policy.parent-loss.v1",
      action: "contain-and-retire",
      replacementAllocation: "forbidden",
    }),
  }),
  Object.freeze({
    key: "retirementPolicyDigest" as const,
    id: "lifecycle.agent-execution-policy.retirement.v1",
    value: Object.freeze({
      schema: "lifecycle.agent-execution-policy.retirement.v1",
      beforeReceipt: "required",
      dispatchAuthority: "permanently-consumed-or-revoked",
      providerCredentialSettlement: "exact-claim-cas-before-retirement",
    }),
  }),
  Object.freeze({
    key: "recoveryPolicyDigest" as const,
    id: "lifecycle.agent-execution-policy.recovery.v1",
    value: Object.freeze({
      schema: "lifecycle.agent-execution-policy.recovery.v1",
      handle: "same-exact-handle",
      redispatch: "forbidden",
    }),
  }),
]);

/**
 * Compile the sole installed Agent execution-policy selection and its exact
 * immutable subject bytes. This is a fixed product selection, not a caller-
 * configurable policy framework.
 */
export function compileFoundationInstalledAgentExecutionPolicyV1():
FoundationInstalledAgentExecutionPolicySelectionV1 {
  const subjects = Object.freeze(FIXED_AGENT_EXECUTION_POLICY_DEFINITIONS_V1.map(
    ({ key, id, value }) => {
      const digest = digestCanonical(value);
      return Object.freeze({
        key,
        id,
        value,
        digest,
        bytes: Uint8Array.from(Buffer.from(`${canonicalJson(value)}\n`, "utf8")),
      });
    },
  ));
  const byKey = new Map(subjects.map((subject) => [subject.key, subject.digest] as const));
  return Object.freeze({
    executionPolicy: Object.freeze({
      cancellationPolicyDigest: byKey.get("cancellationPolicyDigest")!,
      containmentPolicyDigest: byKey.get("containmentPolicyDigest")!,
      parentLossPolicyDigest: byKey.get("parentLossPolicyDigest")!,
      retirementPolicyDigest: byKey.get("retirementPolicyDigest")!,
      recoveryPolicyDigest: byKey.get("recoveryPolicyDigest")!,
    }),
    subjects,
  });
}
