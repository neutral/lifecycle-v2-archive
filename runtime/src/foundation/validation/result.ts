import { LifecycleError } from "../../errors.js";
import { FOUNDATION_SPECIFICATION_REVISION, FOUNDATION_VALIDATION_RESULT_SCHEMA, FOUNDATION_VALIDATOR } from "../constants.js";
import { canonicalJson, digestCanonical, type Sha256 } from "./canonical.js";
import { compareCodePoints, compareNullableCodePoints, sortUniqueCodePoints } from "./ordering.js";
import { FOUNDATION_SCHEMA_ENGINE_IDENTITY, type FoundationSchemaEngineIdentity } from "./schema-engine.js";

export type DiagnosticSeverity = "error" | "warning" | "information";

/** Input accepted by the collector before it constructs the published shape. */
export type FoundationDiagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  path: string | null;
  pointer: string | null;
  related: string[];
  facts: Record<string, unknown>;
  line?: number | null;
  column?: number | null;
  length?: number | null;
};

export type DiagnosticLocation = {
  locator: string | null;
  jsonPointer: string | null;
  line: number | null;
  column: number | null;
  length: number | null;
};

export type DiagnosticRelated = {
  kind: string;
  id: string;
  digest: Sha256 | null;
  location: DiagnosticLocation;
};

export type FoundationValidationDiagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  stage: string;
  location: DiagnosticLocation;
  related: DiagnosticRelated[];
  facts: Record<string, unknown>;
};

export type ValidationStage = {
  id: string;
  complete: boolean;
  valid: boolean;
  diagnosticCount: number;
  durationMs: number;
};

export type ValidationImplementation = {
  id: string;
  version: string;
  digest: Sha256;
  claimedClass: string;
  supportedProfiles: string[];
  schemaEngine: FoundationSchemaEngineIdentity;
  formatAssertion: boolean;
  extensions: string[];
};

export type ValidationSubject = {
  kind: string;
  id: string;
  digest: Sha256 | null;
  revision: string | number | null;
  locator: string | null;
};

export type FoundationValidationResult = {
  schema: typeof FOUNDATION_VALIDATION_RESULT_SCHEMA;
  specificationRevision: string;
  publicationDigest: Sha256 | null;
  profile: string;
  subject: ValidationSubject;
  complete: boolean;
  valid: boolean;
  stages: ValidationStage[];
  diagnostics: FoundationValidationDiagnostic[];
  implementation: ValidationImplementation;
  limits: Record<string, number>;
  observedAt: string;
  digest: Sha256;
};

export type ValidationDigestStage = Pick<ValidationStage, "id" | "complete" | "valid">;
export type ValidationDigestDiagnostic = Omit<FoundationValidationDiagnostic, "message">;

export type ValidationDigestSubject = {
  schema: typeof FOUNDATION_VALIDATION_RESULT_SCHEMA;
  specificationRevision: string;
  publicationDigest: Sha256 | null;
  profile: string;
  subject: ValidationSubject;
  complete: boolean;
  valid: boolean;
  stages: ValidationDigestStage[];
  diagnostics: ValidationDigestDiagnostic[];
  limits: Record<string, number>;
};

export type ValidationStageDeclaration = {
  id: string;
  complete: boolean;
  durationMs?: number;
};

function validationFailure(code: string, message: string, observedFacts?: unknown): never {
  throw new LifecycleError({ code, message, observedFacts });
}

function cloneJsonRecord(value: Record<string, unknown>, label: string): Record<string, unknown> {
  try {
    return JSON.parse(canonicalJson(value)) as Record<string, unknown>;
  } catch (error) {
    validationFailure("foundation.validation.facts", `${label} must contain only bounded canonical JSON values`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function location(options: {
  path?: string | null;
  pointer?: string | null;
  line?: number | null;
  column?: number | null;
  length?: number | null;
}): DiagnosticLocation {
  return {
    locator: options.path ?? null,
    jsonPointer: options.pointer ?? null,
    line: options.line ?? null,
    column: options.column ?? null,
    length: options.length ?? null,
  };
}

function related(value: string): DiagnosticRelated {
  const pathLike = value.includes("/");
  return {
    kind: pathLike ? "repository-path" : "identity",
    id: value,
    digest: null,
    location: location({ path: pathLike ? value : null }),
  };
}

function compareOptionalInteger(left: number | null, right: number | null): number {
  const normalizedLeft = left ?? Number.MAX_SAFE_INTEGER;
  const normalizedRight = right ?? Number.MAX_SAFE_INTEGER;
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function compareRelated(left: DiagnosticRelated, right: DiagnosticRelated): number {
  return compareCodePoints(left.kind, right.kind) ||
    compareCodePoints(left.id, right.id) ||
    compareNullableCodePoints(left.digest, right.digest) ||
    compareNullableCodePoints(left.location.locator, right.location.locator) ||
    compareNullableCodePoints(left.location.jsonPointer, right.location.jsonPointer) ||
    compareOptionalInteger(left.location.line, right.location.line) ||
    compareOptionalInteger(left.location.column, right.location.column);
}

function compareDiagnostics(left: FoundationValidationDiagnostic, right: FoundationValidationDiagnostic): number {
  return compareNullableCodePoints(left.location.locator, right.location.locator) ||
    compareOptionalInteger(left.location.line, right.location.line) ||
    compareOptionalInteger(left.location.column, right.location.column) ||
    compareCodePoints(left.code, right.code) ||
    compareCodePoints(left.message, right.message) ||
    compareCodePoints(left.stage, right.stage) ||
    compareNullableCodePoints(left.location.jsonPointer, right.location.jsonPointer) ||
    compareCodePoints(canonicalJson(left.facts), canonicalJson(right.facts)) ||
    compareCodePoints(canonicalJson(left.related), canonicalJson(right.related));
}

function compareDigestDiagnostics(left: ValidationDigestDiagnostic, right: ValidationDigestDiagnostic): number {
  return compareNullableCodePoints(left.location.locator, right.location.locator) ||
    compareOptionalInteger(left.location.line, right.location.line) ||
    compareOptionalInteger(left.location.column, right.location.column) ||
    compareCodePoints(left.code, right.code) ||
    compareCodePoints(left.severity, right.severity) ||
    compareCodePoints(left.stage, right.stage) ||
    compareNullableCodePoints(left.location.jsonPointer, right.location.jsonPointer) ||
    compareCodePoints(canonicalJson(left.facts), canonicalJson(right.facts)) ||
    compareCodePoints(canonicalJson(left.related), canonicalJson(right.related));
}

function isImplementationInformation(diagnostic: FoundationValidationDiagnostic): boolean {
  return diagnostic.severity === "information" && !diagnostic.code.startsWith("lifecycle.");
}

export function validationDigestSubject(
  result: Omit<FoundationValidationResult, "digest"> | FoundationValidationResult,
): ValidationDigestSubject {
  const diagnostics = result.diagnostics
    .filter((diagnostic) => !isImplementationInformation(diagnostic))
    .map(({ message: _message, ...diagnostic }) => diagnostic)
    .sort(compareDigestDiagnostics);
  return {
    schema: result.schema,
    specificationRevision: result.specificationRevision,
    publicationDigest: result.publicationDigest,
    profile: result.profile,
    subject: result.subject,
    complete: result.complete,
    valid: result.valid,
    stages: result.stages.map(({ id, complete, valid }) => ({ id, complete, valid })),
    diagnostics,
    limits: result.limits,
  };
}

export function validationResultDigest(
  result: Omit<FoundationValidationResult, "digest"> | FoundationValidationResult,
): Sha256 {
  return digestCanonical(validationDigestSubject(result));
}

function defaultImplementation(profile: string): ValidationImplementation {
  return foundationValidationImplementation([profile], []);
}

function implementationDigestSubject(
  implementation: Omit<ValidationImplementation, "digest"> | ValidationImplementation,
): Omit<ValidationImplementation, "digest"> {
  const { digest: _digest, ...subject } = implementation as ValidationImplementation;
  return subject;
}

export function foundationValidationImplementation(
  supportedProfiles: readonly string[],
  extensions: readonly string[],
): ValidationImplementation {
  const base: Omit<ValidationImplementation, "digest"> = {
    ...FOUNDATION_VALIDATOR,
    claimedClass: "foundation-development-validator",
    supportedProfiles: sortUniqueCodePoints(supportedProfiles),
    schemaEngine: FOUNDATION_SCHEMA_ENGINE_IDENTITY,
    formatAssertion: true,
    extensions: sortUniqueCodePoints(extensions),
  };
  return deepFreeze({ ...base, digest: digestCanonical(base) });
}

function normalizeImplementation(value: ValidationImplementation, profile: string): ValidationImplementation {
  const supportedProfiles = sortUniqueCodePoints(value.supportedProfiles);
  const extensions = sortUniqueCodePoints(value.extensions);
  if (!supportedProfiles.includes(profile)) {
    validationFailure("foundation.validation.implementation-profile", `Validation implementation does not declare selected profile ${profile}`);
  }
  if (canonicalJson(value.schemaEngine) !== canonicalJson(FOUNDATION_SCHEMA_ENGINE_IDENTITY)) {
    validationFailure("foundation.validation.schema-engine", "Validation implementation must identify the exact installed schema engine, format package, dialect, and schema set", {
      actual: value.schemaEngine,
      expected: FOUNDATION_SCHEMA_ENGINE_IDENTITY,
    });
  }
  const normalized: ValidationImplementation = {
    ...value,
    supportedProfiles,
    extensions,
    schemaEngine: { ...value.schemaEngine },
  };
  const expected = digestCanonical(implementationDigestSubject(normalized));
  if (normalized.digest !== expected) {
    validationFailure("foundation.validation.implementation-digest", "Validation implementation digest does not bind its exact implementation, schema-set, profile, and extension identity", {
      actual: normalized.digest,
      expected,
    });
  }
  return normalized;
}

function normalizeLimits(values: Record<string, number>): Record<string, number> {
  const entries = Object.entries(values).sort(([left], [right]) => compareCodePoints(left, right));
  for (const [id, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9._:-]*$/u.test(id) || !Number.isSafeInteger(value) || value < 0) {
      validationFailure("foundation.validation.limit", "Validation limits require named nonnegative safe integers", { id, value });
    }
  }
  return Object.fromEntries(entries);
}

export class DiagnosticCollector {
  private readonly values: FoundationValidationDiagnostic[] = [];
  private finalized = false;

  get diagnostics(): readonly FoundationValidationDiagnostic[] {
    return this.values;
  }

  add(options: {
    stage: string;
    code: string;
    severity?: DiagnosticSeverity;
    message: string;
    path?: string | null;
    pointer?: string | null;
    line?: number | null;
    column?: number | null;
    length?: number | null;
    related?: string[];
    facts?: Record<string, unknown>;
  }): void {
    if (this.finalized) validationFailure("foundation.validation.finalized", "A finalized diagnostic collection cannot be changed");
    const diagnostic: FoundationValidationDiagnostic = {
      code: options.code,
      severity: options.severity ?? "error",
      message: options.message,
      stage: options.stage,
      location: location(options),
      related: sortUniqueCodePoints(options.related ?? []).map(related).sort(compareRelated),
      facts: cloneJsonRecord(options.facts ?? {}, `Facts for ${options.code}`),
    };
    this.values.push(diagnostic);
  }

  result(options: {
    profile: string;
    subjectKind: string;
    subjectId: string;
    subjectDigest?: Sha256 | null;
    subjectRevision?: string | number | null;
    subjectLocator?: string | null;
    publicationDigest?: Sha256 | null;
    stages: readonly (string | ValidationStageDeclaration)[];
    limits?: Record<string, number>;
    observedAt?: string;
    implementation?: ValidationImplementation;
  }): FoundationValidationResult {
    if (this.finalized) validationFailure("foundation.validation.finalized", "A diagnostic collection can produce only one validation result");
    this.finalized = true;

    const declarations = options.stages.map((stage): Required<ValidationStageDeclaration> =>
      typeof stage === "string"
        ? { id: stage, complete: true, durationMs: 0 }
        : { id: stage.id, complete: stage.complete, durationMs: stage.durationMs ?? 0 });
    const ids = declarations.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      validationFailure("foundation.validation.stage-duplicate", "Validation stages must be declared exactly once", { stages: ids });
    }
    const declared = new Set(ids);
    const unknownStage = this.values.find((diagnostic) => !declared.has(diagnostic.stage));
    if (unknownStage !== undefined) {
      validationFailure("foundation.validation.stage-undeclared", "Every diagnostic must name one explicitly declared validation stage", {
        stage: unknownStage.stage,
        code: unknownStage.code,
      });
    }
    for (const declaration of declarations) {
      if (!Number.isSafeInteger(declaration.durationMs) || declaration.durationMs < 0) {
        validationFailure("foundation.validation.duration", "Stage duration must be one nonnegative safe integer", {
          stage: declaration.id,
          durationMs: declaration.durationMs,
        });
      }
    }

    const diagnostics = [...this.values].sort(compareDiagnostics);
    const stages = declarations.map(({ id, complete, durationMs }): ValidationStage => {
      const stageDiagnostics = diagnostics.filter((diagnostic) => diagnostic.stage === id);
      return {
        id,
        complete,
        valid: complete && !stageDiagnostics.some((diagnostic) => diagnostic.severity === "error"),
        diagnosticCount: stageDiagnostics.length,
        durationMs,
      };
    });
    const complete = stages.every((stage) => stage.complete);
    const valid = complete && stages.every((stage) => stage.valid) && !diagnostics.some((diagnostic) => diagnostic.severity === "error");
    const implementation = normalizeImplementation(options.implementation ?? defaultImplementation(options.profile), options.profile);
    const base: Omit<FoundationValidationResult, "digest"> = {
      schema: FOUNDATION_VALIDATION_RESULT_SCHEMA,
      specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
      publicationDigest: options.publicationDigest ?? null,
      profile: options.profile,
      subject: {
        kind: options.subjectKind,
        id: options.subjectId,
        digest: options.subjectDigest ?? null,
        revision: options.subjectRevision ?? null,
        locator: options.subjectLocator ?? null,
      },
      complete,
      valid,
      stages,
      diagnostics,
      implementation: {
        ...implementation,
        supportedProfiles: [...implementation.supportedProfiles],
        schemaEngine: { ...implementation.schemaEngine },
        extensions: [...implementation.extensions],
      },
      limits: normalizeLimits(options.limits ?? {}),
      observedAt: options.observedAt ?? new Date().toISOString(),
    };
    const result: FoundationValidationResult = { ...base, digest: validationResultDigest(base) };
    return deepFreeze(result);
  }
}
