import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import formatsModule from "ajv-formats";
import { FoundationError } from "../error.js";
import { canonicalJson } from "./canonical.js";
import {
  FOUNDATION_GENERATED_SCHEMAS,
  FOUNDATION_GENERATED_SCHEMA_SET_DIGEST,
} from "./generated-schemas.js";
import { compareCodePoints } from "./ordering.js";
import type { FoundationDiagnostic } from "./result.js";

export const FOUNDATION_KNOWLEDGE_RECORD_SCHEMA_ID = "urn:lifecycle:schema:knowledge-record:v2";
export const FOUNDATION_DISCIPLINE_REGISTRY_SCHEMA_ID = "urn:lifecycle:schema:discipline-registry:v1";
export const FOUNDATION_DISCIPLINE_PACK_SCHEMA_ID = "urn:lifecycle:schema:discipline-pack:v1";

export type FoundationSchemaEngineIdentity = Readonly<{
  implementation: "ajv";
  version: "8.18.0";
  dialect: "https://json-schema.org/draft/2020-12/schema";
  formats: "ajv-formats-full-3.0.1";
  schemaSetDigest: typeof FOUNDATION_GENERATED_SCHEMA_SET_DIGEST;
}>;

export const FOUNDATION_SCHEMA_ENGINE_IDENTITY: FoundationSchemaEngineIdentity = Object.freeze({
  implementation: "ajv",
  version: "8.18.0",
  dialect: "https://json-schema.org/draft/2020-12/schema",
  formats: "ajv-formats-full-3.0.1",
  schemaSetDigest: FOUNDATION_GENERATED_SCHEMA_SET_DIGEST,
});

type CompiledSchemaEngine = Readonly<{
  validators: ReadonlyMap<string, ValidateFunction>;
}>;

let compiledEngine: CompiledSchemaEngine | null = null;

function schemaEngineFailure(message: string, cause?: unknown): never {
  throw new FoundationError("lifecycle.schema.unsupported", message, {
    observedFacts: cause === undefined
      ? { schemaSetDigest: FOUNDATION_GENERATED_SCHEMA_SET_DIGEST }
      : {
          schemaSetDigest: FOUNDATION_GENERATED_SCHEMA_SET_DIGEST,
          cause: cause instanceof Error ? cause.message : String(cause),
        },
  });
}

function compileSchemaEngine(): CompiledSchemaEngine {
  if (compiledEngine !== null) return compiledEngine;
  try {
    const engine = new Ajv2020({
      allErrors: true,
      strict: true,
      strictTypes: false,
      validateFormats: true,
    });
    formatsModule.default(engine, { mode: "full" });
    for (const carrier of FOUNDATION_GENERATED_SCHEMAS) engine.addSchema(carrier.schema);
    const validators = new Map<string, ValidateFunction>();
    for (const carrier of FOUNDATION_GENERATED_SCHEMAS) {
      const validator = engine.getSchema(carrier.id);
      if (validator === undefined) schemaEngineFailure(`Generated schema ${carrier.id} did not compile`);
      validators.set(carrier.id, validator);
    }
    compiledEngine = Object.freeze({ validators });
    return compiledEngine;
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    schemaEngineFailure("The installed Draft 2020-12 schema set could not be compiled", error);
  }
}

function normalizeJson(value: unknown): unknown {
  return JSON.parse(canonicalJson(value)) as unknown;
}

function compareSchemaDiagnostics(left: FoundationDiagnostic, right: FoundationDiagnostic): number {
  return compareCodePoints(left.pointer ?? "", right.pointer ?? "") ||
    compareCodePoints(String(left.facts.schemaPath ?? ""), String(right.facts.schemaPath ?? "")) ||
    compareCodePoints(String(left.facts.keyword ?? ""), String(right.facts.keyword ?? "")) ||
    compareCodePoints(canonicalJson(left.facts.params), canonicalJson(right.facts.params)) ||
    compareCodePoints(left.message, right.message);
}

function schemaDiagnostic(error: ErrorObject, path: string, schemaId: string): FoundationDiagnostic {
  const pointer = error.instancePath;
  const location = pointer.length === 0 ? "the document root" : pointer;
  return Object.freeze({
    code: "lifecycle.schema.invalid",
    severity: "error",
    message: `${schemaId} ${error.keyword} constraint failed at ${location}: ${error.message ?? "schema assertion failed"}`,
    path,
    pointer,
    related: [] as string[],
    facts: Object.freeze({
      keyword: error.keyword,
      schemaPath: error.schemaPath,
      params: normalizeJson(error.params),
    }),
  });
}

export function foundationSchemaIds(): readonly string[] {
  return Object.freeze(FOUNDATION_GENERATED_SCHEMAS.map(({ id }) => id));
}

/** Exact target-selected schema set owned by the published Repository Contract schema. */
export function foundationRepositorySchemaIds(): readonly string[] {
  const carrier = FOUNDATION_GENERATED_SCHEMAS.find(({ id }) => id === "urn:lifecycle:schema:repository-contract:v22");
  const root = carrier?.schema;
  const rootProperties = root?.properties;
  const selections = rootProperties !== null && typeof rootProperties === "object" && !Array.isArray(rootProperties)
    ? (rootProperties as Record<string, unknown>).selections
    : undefined;
  const selectionProperties = selections !== null && typeof selections === "object" && !Array.isArray(selections)
    ? (selections as Record<string, unknown>).properties
    : undefined;
  const schemas = selectionProperties !== null && typeof selectionProperties === "object" && !Array.isArray(selectionProperties)
    ? (selectionProperties as Record<string, unknown>).schemas
    : undefined;
  const selected = schemas !== null && typeof schemas === "object" && !Array.isArray(schemas)
    ? (schemas as Record<string, unknown>).const
    : undefined;
  if (!Array.isArray(selected) || selected.length === 0 || selected.some((id) => typeof id !== "string") ||
      new Set(selected).size !== selected.length) {
    schemaEngineFailure("The installed Repository Contract schema lacks one exact schema selection");
  }
  const ordered = [...selected] as string[];
  if (ordered.some((id, index) => index > 0 && compareCodePoints(ordered[index - 1]!, id) >= 0)) {
    schemaEngineFailure("The installed Repository Contract schema selection is not code-point ordered");
  }
  return Object.freeze(ordered);
}

export function validateFoundationSchema(
  schemaId: string,
  value: unknown,
  path: string,
): readonly FoundationDiagnostic[] {
  const validator = compileSchemaEngine().validators.get(schemaId);
  if (validator === undefined) schemaEngineFailure(`The installed schema set does not contain ${schemaId}`);
  // Validation is defined over JSON values, not JavaScript object prototypes.
  // Strict parsers intentionally construct null-prototype objects; normalize
  // through the canonical JSON domain before AJV so const/deep-equality checks
  // cannot invoke inherited methods that those values deliberately lack.
  const normalized = normalizeJson(value);
  if (validator(normalized)) return Object.freeze([]);
  const diagnostics = (validator.errors ?? [])
    .map((error) => schemaDiagnostic(error, path, schemaId))
    .sort(compareSchemaDiagnostics);
  if (diagnostics.length === 0) schemaEngineFailure(`Schema ${schemaId} failed without diagnostics`);
  return Object.freeze(diagnostics);
}

export function assertFoundationSchema(schemaId: string, value: unknown, path: string): void {
  const diagnostics = validateFoundationSchema(schemaId, value, path);
  if (diagnostics.length === 0) return;
  throw new FoundationError(
    "lifecycle.schema.invalid",
    `${path} fails ${schemaId} with ${diagnostics.length} deterministic schema diagnostic${diagnostics.length === 1 ? "" : "s"}`,
    {
      diagnostics,
      observedFacts: {
        schemaId,
        schemaSetDigest: FOUNDATION_GENERATED_SCHEMA_SET_DIGEST,
        diagnosticCount: diagnostics.length,
      },
    },
  );
}
