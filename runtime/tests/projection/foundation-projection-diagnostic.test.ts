import assert from "node:assert/strict";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import { foundationProjectionDiagnosticFacts } from "../../src/foundation/projection/diagnostic.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";

const validationDigest = sha256Bytes("exact rejected Projection validation");
const diagnosticCodes = ["lifecycle.projection.discipline-invalid", "lifecycle.schema.invalid"];
const outerCode = "lifecycle.operation-context-v7.projection";

function failure(observedFacts: unknown, code = outerCode): FoundationError {
  return new FoundationError(code, "fixture-private-message", { observedFacts });
}

test("Projection diagnostic disclosure preserves exact public codes and digest, excluding private extras", () => {
  for (const code of [outerCode, "lifecycle.preparation-context-v7.projection"]) {
    const diagnostics = [...diagnosticCodes];
    const facts = foundationProjectionDiagnosticFacts(failure({
      validationDigest, diagnostics, path: "/private/fixture-private-path",
      message: "fixture-private-message", nested: { stdout: "fixture-private-output" },
    }, code));
    assert.deepEqual(facts, { validationDigest, diagnosticCodes });
    diagnostics[0] = "substituted";
    assert.deepEqual(facts?.diagnosticCodes, diagnosticCodes);
    assert.equal(JSON.stringify(facts).includes("fixture-private"), false);
    assert(Object.isFrozen(facts));
    assert(Object.isFrozen(facts?.diagnosticCodes));
  }
});

test("Projection diagnostic disclosure refuses malformed, unknown and over-bound facts without partial output", () => {
  const valid = { validationDigest, diagnostics: diagnosticCodes };
  for (const facts of [
    null, [], {},
    { ...valid, validationDigest: "fixture-private-value" },
    { ...valid, validationDigest: `${validationDigest}\n` },
    { ...valid, validationDigest: `sha256:${"A".repeat(64)}` },
    { ...valid, diagnostics: [] },
    { ...valid, diagnostics: "lifecycle.projection.discipline-invalid" },
    { ...valid, diagnostics: [null] },
    { ...valid, diagnostics: Array(1) },
    { ...valid, diagnostics: ["lifecycle.projection.discipline-invalid.fixture-private-value"] },
    { ...valid, diagnostics: ["lifecycle.projection." + "x".repeat(129)] },
    { ...valid, diagnostics: [...diagnosticCodes, "lifecycle.unknown"] },
    { ...valid, diagnostics: ["/private/fixture-private-path"] },
    { ...valid, diagnostics: Array(65).fill(diagnosticCodes[0]) },
  ]) assert.equal(foundationProjectionDiagnosticFacts(failure(facts)), null);
  for (const error of [
    null, new Error("fixture-private-message"),
    { code: outerCode, observedFacts: valid },
    failure(valid, `${outerCode}.fixture-private-value`),
    failure(valid, "lifecycle.other"),
  ]) assert.equal(foundationProjectionDiagnosticFacts(error), null);
  const atLimit = Array(64).fill(diagnosticCodes[0]);
  assert.deepEqual(foundationProjectionDiagnosticFacts(failure({ validationDigest, diagnostics: atLimit })), {
    validationDigest, diagnosticCodes: atLimit,
  });
});
