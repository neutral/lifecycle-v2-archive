import assert from "node:assert/strict";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import { assertFoundationSchema } from "../../src/foundation/validation/schema-engine.js";

const REJECTED_RATIONALE = "private-invalid-rationale-must-not-be-echoed";

type SerializedDiagnostic = Readonly<{
  pointer: string | null;
  facts: Readonly<{
    keyword: string;
    params: unknown;
  }>;
}>;

test("Foundation error JSON preserves current schema diagnostics without rejected values", () => {
  let failure: FoundationError | null = null;
  try {
    assertFoundationSchema(
      "urn:lifecycle:schema:repository-contract:v22",
      { $schema: REJECTED_RATIONALE },
      "foundation-error-current-schema",
    );
  } catch (error) {
    assert(error instanceof FoundationError);
    failure = error;
  }
  if (failure === null) assert.fail("Expected the invalid current schema subject to fail validation");

  assert.equal(failure.toJSON().diagnostics?.length, failure.diagnostics.length);
  const serialized = JSON.stringify({ error: failure });
  const result = JSON.parse(serialized) as Readonly<{
    error: Readonly<{
      code: string;
      observedFacts: Readonly<{ diagnosticCount: number }>;
      diagnostics: readonly SerializedDiagnostic[];
    }>;
  }>;
  assert.equal(result.error.code, "lifecycle.schema.invalid");
  assert.equal(result.error.diagnostics.length, result.error.observedFacts.diagnosticCount);
  assert(result.error.diagnostics.some((diagnostic) => {
    const params = diagnostic.facts.params as Readonly<{ allowedValue?: unknown }>;
    return diagnostic.pointer === "/$schema" &&
      diagnostic.facts.keyword === "const" &&
      params.allowedValue === "lifecycle.repository.v22";
  }));
  assert.equal(serialized.includes(REJECTED_RATIONALE), false);

  const withoutDiagnostics = new FoundationError("test.foundation-error", "No diagnostics").toJSON();
  assert.equal(Object.hasOwn(withoutDiagnostics, "diagnostics"), false);
});
