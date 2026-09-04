import { LifecycleError, type LifecycleErrorJson, type RecoveryAction } from "../errors.js";
import type { FoundationDiagnostic, FoundationValidationDiagnostic } from "./validation/result.js";

type FoundationErrorJson = LifecycleErrorJson & Readonly<{
  diagnostics?: readonly (FoundationDiagnostic | FoundationValidationDiagnostic)[];
}>;

export class FoundationError extends LifecycleError {
  readonly diagnostics: readonly (FoundationDiagnostic | FoundationValidationDiagnostic)[];

  constructor(
    code: string,
    message: string,
    options: {
      diagnostics?: readonly (FoundationDiagnostic | FoundationValidationDiagnostic)[];
      retryable?: boolean;
      repositoryChanged?: boolean;
      operationalStateChanged?: boolean;
      recoveryActions?: RecoveryAction[];
      observedFacts?: unknown;
    } = {},
  ) {
    super({
      code,
      message,
      retryable: options.retryable,
      repositoryChanged: options.repositoryChanged,
      operationalStateChanged: options.operationalStateChanged,
      recoveryActions: options.recoveryActions,
      observedFacts: options.observedFacts,
    });
    this.name = "FoundationError";
    this.diagnostics = options.diagnostics ?? [];
  }

  override toJSON(): FoundationErrorJson {
    const failure = super.toJSON();
    return this.diagnostics.length === 0
      ? failure
      : { ...failure, diagnostics: this.diagnostics };
  }
}
