export type RecoveryAction = {
  action: string;
  detail: string;
};

export type LifecycleErrorJson = {
  code: string;
  message: string;
  retryable: boolean;
  repositoryChanged: boolean;
  operationalStateChanged: boolean;
  recoveryActions: RecoveryAction[];
  observedFacts?: unknown;
};

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Lifecycle encountered an unexpected failure";
}

export class LifecycleError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly repositoryChanged: boolean;
  readonly operationalStateChanged: boolean;
  readonly recoveryActions: RecoveryAction[];
  readonly observedFacts?: unknown;

  constructor(options: {
    code: string;
    message: string;
    retryable?: boolean;
    repositoryChanged?: boolean;
    operationalStateChanged?: boolean;
    recoveryActions?: RecoveryAction[];
    observedFacts?: unknown;
  }) {
    super(options.message);
    this.name = "LifecycleError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.repositoryChanged = options.repositoryChanged ?? false;
    this.operationalStateChanged = options.operationalStateChanged ?? false;
    this.recoveryActions = options.recoveryActions ?? [];
    this.observedFacts = options.observedFacts;
  }

  toJSON(): LifecycleErrorJson {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      repositoryChanged: this.repositoryChanged,
      operationalStateChanged: this.operationalStateChanged,
      recoveryActions: this.recoveryActions.map((action) => ({ ...action })),
      ...(this.observedFacts === undefined ? {} : { observedFacts: this.observedFacts }),
    };
  }
}

export function asLifecycleError(error: unknown): LifecycleError {
  if (error instanceof LifecycleError) return error;
  return new LifecycleError({ code: "runtime.unexpected", message: safeMessage(error) });
}
