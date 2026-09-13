import assert from "node:assert/strict";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import {
  foundationExecutionBackendDiagnosticFacts,
  foundationExecutionBackendInterruptionFacts,
} from "../../src/foundation/execution/backend-diagnostic.js";

test("every interrupted Backend stage carries a fixed class without caught text", () => {
  // Independent finite stage domain; this does not exercise physical Backend effects.
  for (const operation of [
    "allocate", "allocation-observe", "pre-dispatch-observe", "dispatch",
    "observe", "cancel", "terminal-retrieval", "output-retrieval", "reclamation-binding",
  ] as const) {
    const facts = foundationExecutionBackendInterruptionFacts(operation, new FoundationError(
      "lifecycle.execution.docker-cli-driver.command-timeout", "fixture-secret-message",
      { observedFacts: { path: "/private/fixture-secret-path" } },
    ));
    assert.deepEqual(facts, { backendOperation: operation, backendFailureClass: "command-timeout" });
    const outer = new FoundationError("lifecycle.execution.operation-host.backend-interrupted", "fixed", {
      observedFacts: { ...facts, privatePath: "/private/fixture-secret-path" },
    });
    assert.deepEqual(foundationExecutionBackendDiagnosticFacts(outer), facts);
    assert.equal(JSON.stringify(facts).includes("fixture-secret"), false);
  }
});

test("caught Backend classification recognizes exact owner codes and excludes lookalikes", () => {
  for (const [code, classification] of [
    ["lifecycle.execution.docker-cli-driver.command-unavailable", "command-unavailable"],
    ["lifecycle.execution.docker-cli-driver.command-output-bound", "command-output-bound"],
    ["lifecycle.execution.docker-cli-driver.engine-command", "engine-command-failed"],
    ["lifecycle.execution.docker-cli-driver.provider-support", "provider-support-refused"],
    ["lifecycle.execution.docker-cli-driver.provider-channel-integrity", "provider-channel-refused"],
    ["lifecycle.execution.docker-backend.observation-sequence", "observation-refused"],
    ["lifecycle.execution.docker-backend.retrieval-source-changed", "retrieval-refused"],
    ["lifecycle.execution.retrieval-outcome-invalid", "retrieval-refused"],
    ["lifecycle.execution.reclamation-binding-invalid", "reclamation-binding-refused"],
    ["lifecycle.schema.invalid", "backend-result-invalid"],
  ] as const) {
    assert.equal(foundationExecutionBackendInterruptionFacts("observe",
      new FoundationError(code, "excluded")).backendFailureClass, classification);
  }
  for (const error of [
    new Error("fixture-secret"),
    { code: "lifecycle.execution.docker-cli-driver.command-timeout", message: "fixture-secret" },
    new FoundationError("lifecycle.execution.docker-cli-driver.command-timeout.fixture-secret", "excluded"),
    new FoundationError("fixture-secret", "excluded"),
    null,
  ]) {
    assert.deepEqual(foundationExecutionBackendInterruptionFacts("dispatch", error), {
      backendOperation: "dispatch", backendFailureClass: "unknown",
    });
  }
});

test("public Backend facts reject substituted stages, classes and unrelated errors", () => {
  for (const facts of [null, [], { backendOperation: "observe" },
    { backendOperation: "fixture-secret", backendFailureClass: "command-timeout" },
    { backendOperation: "observe", backendFailureClass: "fixture-secret" }]) {
    assert.equal(foundationExecutionBackendDiagnosticFacts(new FoundationError(
      "lifecycle.execution.operation-host.backend-interrupted", "excluded", { observedFacts: facts },
    )), null);
  }
  assert.equal(foundationExecutionBackendDiagnosticFacts(new FoundationError("lifecycle.other", "excluded", {
    observedFacts: { backendOperation: "observe", backendFailureClass: "command-timeout" },
  })), null);
});
