import assert from "node:assert/strict";
import test from "node:test";
import { createLifecycleCliHandoff, renderLifecycleCliHandoff } from "../src/domain/handoff.js";
import { testObservation } from "./support/protocol-v10.js";

function reviewed() {
  const observation = testObservation();
  return {
    targetId: observation.repository.targetId,
    deliveryId: observation.delivery?.processId ?? null,
    repositoryContractDigest: observation.repository.repositoryContractDigest,
    headCommit: observation.repository.headCommit,
  };
}

test("handoff is print-only and carries the exact reviewed Delivery identity", () => {
  const handoff = createLifecycleCliHandoff({ operation: "delivery.admit", executable: "/opt/lifecycle", command: "admit", target: "/work/product", deliveryId: "delivery-tui-v10", inputKind: "none", authoritySecretRequired: true, reviewed: reviewed() });
  assert.equal(handoff.mode, "print-only");
  assert.deepEqual(handoff.argv.slice(0, 4), ["/opt/lifecycle", "admit", "/work/product", "delivery-tui-v10"]);
  assert.deepEqual(handoff.argv.slice(-4), ["--authority-secret-file", "<authority-secret-file>", "--format", "human"]);
  assert.match(renderLifecycleCliHandoff(handoff), /print-only handoff/u);
  assert.match(renderLifecycleCliHandoff(handoff), /Delivery: delivery-tui-v10/u);
  assert.match(renderLifecycleCliHandoff(handoff), /runtime-derived/u);
});

test("terminal-unsafe values suppress shell rendering without granting terminal authority", () => {
  const handoff = createLifecycleCliHandoff({ operation: "delivery.inspect", executable: "lifecycle", command: "inspect", target: "/work/line\nbreak", deliveryId: "delivery-tui-v10", inputKind: "none", authoritySecretRequired: false, reviewed: reviewed() });
  assert.equal(handoff.shellCommand, null);
  assert.match(renderLifecycleCliHandoff(handoff), /terminal-unsafe/u);
});

test("repository initialization is the only handoff without a Delivery identity", () => {
  const handoff = createLifecycleCliHandoff({
    operation: "repository.initialize",
    executable: "lifecycle",
    command: "initialize",
    target: "/work/fresh",
    deliveryId: null,
    inputKind: "initialization-file",
    authoritySecretRequired: true,
    reviewed: { targetId: null, deliveryId: null, repositoryContractDigest: null, headCommit: null },
  });
  assert.deepEqual(handoff.argv.slice(0, 3), ["lifecycle", "initialize", "/work/fresh"]);
  assert.equal(handoff.argv.includes("delivery-tui-v10"), false);
});

test("fresh preparation is identity-free even when launched beside an existing Delivery", () => {
  const handoff = createLifecycleCliHandoff({
    operation: "delivery.prepare",
    executable: "lifecycle",
    command: "prepare",
    target: "/work/product",
    deliveryId: null,
    inputKind: "semantic-markdown-file",
    authoritySecretRequired: false,
    reviewed: { ...reviewed(), deliveryId: null },
  });
  assert.deepEqual(handoff.argv.slice(0, 3), ["lifecycle", "prepare", "/work/product"]);
  assert.equal(handoff.argv[3], "--input");
});

test("a later operation refuses a missing or substituted reviewed Delivery identity", () => {
  assert.throws(() => createLifecycleCliHandoff({
    operation: "delivery.continue",
    executable: "lifecycle",
    command: "continue",
    target: "/work/product",
    deliveryId: null,
    inputKind: "semantic-markdown-file",
    authoritySecretRequired: false,
    reviewed: { ...reviewed(), deliveryId: null },
  }), /exact reviewed Delivery identity/u);
  assert.throws(() => createLifecycleCliHandoff({
    operation: "delivery.continue",
    executable: "lifecycle",
    command: "continue",
    target: "/work/product",
    deliveryId: "delivery-other",
    inputKind: "semantic-markdown-file",
    authoritySecretRequired: false,
    reviewed: reviewed(),
  }), /exact reviewed Delivery identity/u);
});
