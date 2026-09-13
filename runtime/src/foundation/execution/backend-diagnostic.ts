import { FoundationError } from "../error.js";

const INTERRUPTION_CODE = "lifecycle.execution.operation-host.backend-interrupted";

const BACKEND_OPERATIONS = [
  "allocate", "allocation-observe", "pre-dispatch-observe", "dispatch",
  "observe", "cancel", "terminal-retrieval", "output-retrieval", "reclamation-binding",
] as const;

export type FoundationExecutionBackendOperation = typeof BACKEND_OPERATIONS[number];

// Exact owner codes only. Neither prefixes nor arbitrary caught strings become
// public facts. These classes describe the refused boundary, not its cause.
const BACKEND_FAILURE_CLASSES = {
  "lifecycle.execution.docker-cli-driver.command-timeout": "command-timeout",
  "lifecycle.execution.docker-cli-driver.command-unavailable": "command-unavailable",
  "lifecycle.execution.docker-cli-driver.command-output-bound": "command-output-bound",
  "lifecycle.execution.docker-cli-driver.engine-command": "engine-command-failed",
  "lifecycle.execution.docker-cli-driver.executable": "executable-refused",
  "lifecycle.execution.docker-cli-driver.response": "backend-result-invalid",
  "lifecycle.execution.docker-cli-driver.cell-integrity": "backend-result-invalid",
  "lifecycle.execution.docker-cli-driver.engine-substitution": "backend-result-invalid",
  "lifecycle.execution.docker-cli-driver.provider-channel-integrity": "provider-channel-refused",
  "lifecycle.execution.docker-cli-driver.provider-channel-unavailable": "provider-channel-unavailable",
  "lifecycle.execution.docker-cli-driver.provider-support": "provider-support-refused",
  "lifecycle.execution.docker-cli-driver.start": "dispatch-refused",
  "lifecycle.execution.docker-cli-driver.output": "output-refused",
  "lifecycle.execution.docker-cli-driver.transport": "output-refused",
  "lifecycle.execution.docker-backend.allocation-unavailable": "allocation-unavailable",
  "lifecycle.execution.docker-backend.observation-sequence": "observation-refused",
  "lifecycle.execution.docker-backend.retrieval-source": "retrieval-refused",
  "lifecycle.execution.docker-backend.retrieval-source-changed": "retrieval-refused",
  "lifecycle.execution.docker-backend.containment-required": "retrieval-refused",
  "lifecycle.execution.docker-backend.output-not-applicable": "retrieval-refused",
  "lifecycle.execution.docker-backend.reclamation-binding": "reclamation-binding-refused",
  "lifecycle.execution.reclamation-binding-invalid": "reclamation-binding-refused",
  "lifecycle.execution.retrieval-outcome-invalid": "retrieval-refused",
  "lifecycle.schema.invalid": "backend-result-invalid",
} as const;

type BackendFailureClass = typeof BACKEND_FAILURE_CLASSES[keyof typeof BACKEND_FAILURE_CLASSES] | "unknown";

export type FoundationExecutionBackendInterruptionFacts = Readonly<{
  backendOperation: FoundationExecutionBackendOperation;
  backendFailureClass: BackendFailureClass;
}>;

/** Classify one caught Backend failure without retaining its message or data. */
export function foundationExecutionBackendInterruptionFacts(
  backendOperation: FoundationExecutionBackendOperation,
  error: unknown,
): FoundationExecutionBackendInterruptionFacts {
  const backendFailureClass = error instanceof FoundationError &&
      Object.hasOwn(BACKEND_FAILURE_CLASSES, error.code)
    ? BACKEND_FAILURE_CLASSES[error.code as keyof typeof BACKEND_FAILURE_CLASSES]
    : "unknown";
  return Object.freeze({ backendOperation, backendFailureClass });
}

/** Revalidate the closed disclosure at the public mutation-result boundary. */
export function foundationExecutionBackendDiagnosticFacts(
  error: unknown,
): FoundationExecutionBackendInterruptionFacts | null {
  if (!(error instanceof FoundationError) || error.code !== INTERRUPTION_CODE) return null;
  const facts = error.observedFacts;
  if (typeof facts !== "object" || facts === null || Array.isArray(facts)) return null;
  const { backendOperation, backendFailureClass } = facts as Record<string, unknown>;
  if (!BACKEND_OPERATIONS.some((operation) => operation === backendOperation) ||
      (backendFailureClass !== "unknown" &&
        !Object.values(BACKEND_FAILURE_CLASSES).some((value) => value === backendFailureClass))) return null;
  // Extra private facts, even on this exact error, never cross this boundary.
  return Object.freeze({
    backendOperation: backendOperation as FoundationExecutionBackendOperation,
    backendFailureClass: backendFailureClass as BackendFailureClass,
  });
}
