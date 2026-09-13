import type { AgentAttemptOperation } from "../control/agent-attempt.js";

/**
 * Current choices for a future Attempt, shared by its preview and fresh
 * Investment construction. Recovery consumes the retained Investment.
 */
export function selectFoundationAgentAttemptPolicyV7(input: Readonly<{
  operation: AgentAttemptOperation;
  configuration: Readonly<{ model: string; reasoning: string }>;
}>) {
  const rationale: Readonly<Record<AgentAttemptOperation, string>> = Object.freeze({
    "delivery.prepare": "fresh-reconnaissance",
    "delivery.continue": "fresh-candidate-development",
    "delivery.evaluate": "fresh-independent-review",
    "delivery.revise": "fresh-boundary-revision-reconnaissance",
    "delivery.reaffirm": "fresh-boundary-reaffirmation-reconnaissance",
  });
  const storageBytes = 256 * 1024 * 1024;
  return Object.freeze({
    model: input.configuration.model,
    reasoning: input.configuration.reasoning,
    wallTimeMs: 30 * 60 * 1_000,
    limits: Object.freeze({
      tokens: null,
      events: 10_000,
      // Builder Output carries the complete repository, including unchanged files.
      outputBytes: input.operation === "delivery.continue" ? storageBytes : 1024 * 1024,
      toolCalls: null,
      // The Docker PID budget includes threads as well as tool processes.
      // Retained Attempts keep their original allocation.
      processes: 128,
      storageBytes,
    }),
    rationale: rationale[input.operation],
  });
}
