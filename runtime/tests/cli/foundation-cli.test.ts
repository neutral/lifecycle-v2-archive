import { assertFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LifecycleError } from "../../src/errors.js";
import {
  FOUNDATION_CLI_ACTION_NAMES,
  FOUNDATION_CLI_WORK_JSON_INPUT_MAXIMUM_BYTES,
  dispatchFoundationCli,
  foundationCliOptionNames,
} from "../../src/foundation/cli.js";
import {
  FOUNDATION_RUNTIME_FACADE_SCHEMA,
  type FoundationRuntimeExecutionContext,
  type FoundationRuntimeFacade,
  type FoundationRuntimeOperationRequest,
} from "../../src/foundation/facade.js";

function recordingFacade(): Readonly<{
  facade: FoundationRuntimeFacade;
  requests: FoundationRuntimeOperationRequest[];
  contexts: FoundationRuntimeExecutionContext[];
}> {
  const requests: FoundationRuntimeOperationRequest[] = [];
  const contexts: FoundationRuntimeExecutionContext[] = [];
  return Object.freeze({
    requests,
    contexts,
    facade: Object.freeze({
      execute: async (
        request: FoundationRuntimeOperationRequest,
        context: FoundationRuntimeExecutionContext = {},
      ) => {
        if (context.authorityCredential !== undefined) {
          assertFoundationAuthorityCredential(context.authorityCredential, request.operation === "repository.initialize" ? "initialize" : "director-decision");
        }
        requests.push(request);
        contexts.push(context);
        return Object.freeze({
          operation: request.operation,
          status: "completed",
          value: Object.freeze({}),
        }) as never;
      },
    }),
  });
}

test("CLI exposes only the current operation and option surface", async () => {
  assert.deepEqual(FOUNDATION_CLI_ACTION_NAMES, [
    "initialize",
    "validate",
    "inbox",
    "status",
    "prepare",
    "admit",
    "continue",
    "integrate",
    "evaluate",
    "revise",
    "reaffirm",
    "accept",
    "no-ship",
    "recover",
    "work",
    "inspect",
    "diff",
    "watch",
    "export",
  ]);
  assert.deepEqual(foundationCliOptionNames("initialize"), [
    "input",
    "authority-secret-file",
    "format",
  ]);
  assert.deepEqual(foundationCliOptionNames("validate"), ["format"]);
  assert.deepEqual(foundationCliOptionNames("inbox"), ["input", "format"]);
  assert.deepEqual(foundationCliOptionNames("prepare"), ["input", "format"]);
  assert.deepEqual(foundationCliOptionNames("admit"), ["authority-secret-file", "format"]);
  assert.deepEqual(foundationCliOptionNames("no-ship"), [
    "input",
    "authority-secret-file",
    "format",
  ]);
  assert.deepEqual(foundationCliOptionNames("inspect"), ["input", "format"]);
  assert.deepEqual(foundationCliOptionNames("diff"), ["input", "format"]);
  assert.deepEqual(foundationCliOptionNames("watch"), ["input", "format"]);
  assert.deepEqual(foundationCliOptionNames("continue"), [
    "input",
    "expected-generation",
    "format",
  ]);
  assert.deepEqual(foundationCliOptionNames("export"), ["input", "format"]);
  assert.deepEqual(foundationCliOptionNames("recover"), ["format"]);
  assert.deepEqual(foundationCliOptionNames("integrate"), ["expected-generation", "format"]);
  for (const retired of ["readmit", "select-no-ship", "authorize-no-ship"]) {
    await assert.rejects(
      dispatchFoundationCli([retired, "/target"], { facade: recordingFacade().facade }),
      /Unknown Lifecycle Foundation action/u,
    );
  }
});

test("prepare creates a Delivery from exact semantic Markdown without caller mechanics", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-v7-prepare-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "prepare.md");
  const markdown = "# Director Brief\n\nPrepare one exact Work Boundary proposal.\n";
  await writeFile(inputPath, markdown, "utf8");
  const recorded = recordingFacade();

  await dispatchFoundationCli([
    "prepare",
    "/target",
    "--input", inputPath,
  ], { facade: recorded.facade });

  assert.deepEqual(recorded.requests, [{
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    operation: "delivery.prepare",
    input: { semanticMarkdown: markdown },
  }]);
  assert.deepEqual(recorded.contexts, [{}]);
  for (const forbidden of [
    "deliveryId",
    "requestId",
    "expected",
    "expectedProcess",
    "package",
    "observedAt",
  ]) {
    assert.equal(forbidden in recorded.requests[0]!, false, forbidden);
  }
});

test("commands for one selected Delivery require its exact identity", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-v7-delivery-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const semanticPath = join(directory, "semantic.md");
  const queryPath = join(directory, "query.json");
  await writeFile(semanticPath, "Continue the exact Candidate.\n", "utf8");
  await writeFile(queryPath, JSON.stringify({ kind: "summary" }), "utf8");

  for (const [selected, options] of [
    ["status", []],
    ["continue", ["--input", semanticPath]],
    ["recover", []],
    ["integrate", ["--expected-generation", `sha256:${"7".repeat(64)}`]],
    ["inspect", ["--input", queryPath]],
  ] as const) {
    const recorded = recordingFacade();
    await assert.rejects(
      dispatchFoundationCli([selected, "/target", ...options], { facade: recorded.facade }),
      /requires exactly one target repository path and one Delivery identity/u,
    );
    assert.equal(recorded.requests.length, 0);
  }

  const status = recordingFacade();
  await dispatchFoundationCli(["status", "/target", "delivery-42"], { facade: status.facade });
  assert.deepEqual(status.requests[0], {
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    deliveryId: "delivery-42",
    operation: "delivery.status",
    input: null,
  });

  await assert.rejects(
    dispatchFoundationCli([
      "prepare", "/target", "caller-selected-delivery", "--input", semanticPath,
    ], { facade: recordingFacade().facade }),
    /requires exactly one target repository path/u,
  );
});

test("validate, semantic Delivery work, and recovery use their exact operation-owned inputs", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-v7-inputs-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const semanticPath = join(directory, "brief.md");
  const semanticMarkdown = "# Director Brief\n\nPerform one bounded Delivery activity.\n";
  const expectedGeneration = `sha256:${"a".repeat(64)}`;
  await writeFile(semanticPath, semanticMarkdown, "utf8");

  const validate = recordingFacade();
  await dispatchFoundationCli(["validate", "/target"], { facade: validate.facade });
  assert.deepEqual(validate.requests[0], {
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    operation: "repository.validate",
    input: null,
  });

  for (const [selected, expectedOperation] of [
    ["continue", "delivery.continue"],
    ["evaluate", "delivery.evaluate"],
    ["revise", "delivery.revise"],
    ["reaffirm", "delivery.reaffirm"],
  ] as const) {
    const recorded = recordingFacade();
    await dispatchFoundationCli([
      selected,
      "/target",
      "delivery-42",
      "--input", semanticPath,
      "--expected-generation", expectedGeneration,
    ], { facade: recorded.facade });
    assert.deepEqual(recorded.requests[0], {
      schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
      target: "/target",
      deliveryId: "delivery-42",
      operation: expectedOperation,
      input: { semanticMarkdown, expectedGeneration },
    });
    assert.deepEqual(recorded.contexts[0], {});
  }

  const recover = recordingFacade();
  await dispatchFoundationCli([
    "recover", "/target", "delivery-42",
  ], { facade: recover.facade });
  assert.deepEqual(recover.requests[0], {
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    deliveryId: "delivery-42",
    operation: "delivery.recover",
    input: null,
  });
});

test("authority operations pass opaque credentials without secret bytes in the execution context", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-v7-authority-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const semanticPath = join(directory, "no-ship.md");
  const authorityPath = join(directory, "authority.secret");
  const semanticMarkdown = "# Director Decision\n\nDo not ship this Delivery.\n";
  await writeFile(semanticPath, semanticMarkdown, "utf8");
  const readAuthoritySecret = async (path: string): Promise<string> => {
    assert.equal(path, authorityPath);
    return "private-director-secret-with-at-least-thirty-two-bytes";
  };

  for (const [selected, expectedOperation] of [
    ["admit", "delivery.admit"],
    ["accept", "delivery.accept"],
  ] as const) {
    const recorded = recordingFacade();
    await dispatchFoundationCli([
      selected,
      "/target",
      "delivery-42",
      "--authority-secret-file", authorityPath,
    ], { facade: recorded.facade, readAuthoritySecret });
    assert.deepEqual(recorded.requests[0], {
      schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
      target: "/target",
      deliveryId: "delivery-42",
      operation: expectedOperation,
      input: null,
    });
    assert.throws(() => assertFoundationAuthorityCredential(recorded.contexts[0]?.authorityCredential, "director-decision"), /live credential/u);
    assert.doesNotMatch(JSON.stringify(recorded.contexts[0]), /private-|authoritySecret/u);
  }

  const noShip = recordingFacade();
  await dispatchFoundationCli([
    "no-ship",
    "/target",
    "delivery-42",
    "--input", semanticPath,
    "--authority-secret-file", authorityPath,
  ], { facade: noShip.facade, readAuthoritySecret });
  assert.deepEqual(noShip.requests[0], {
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    deliveryId: "delivery-42",
    operation: "delivery.no-ship",
    input: {
      semanticMarkdown,
    },
  });
  assert.throws(() => assertFoundationAuthorityCredential(noShip.contexts[0]?.authorityCredential, "director-decision"), /live credential/u);
    assert.doesNotMatch(JSON.stringify(noShip.contexts[0]), /private-|authoritySecret/u);
  assert.equal("authoritySecret" in noShip.requests[0]!, false);
  assert.doesNotMatch(JSON.stringify(noShip.requests[0]), /authorityProof/u);
});

test("inspect and export compile strict JSON selections into exact public queries", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-v7-inspection-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const inspectPath = join(directory, "inspect.json");
  const exportPath = join(directory, "export.json");
  await writeFile(inspectPath, JSON.stringify({
    kind: "dossier",
    dossier: "candidate",
    afterRecordId: null,
    limit: 50,
  }), "utf8");
  await writeFile(exportPath, JSON.stringify({
    kind: "dossier",
    dossier: "evidence",
  }), "utf8");

  const inspect = recordingFacade();
  await dispatchFoundationCli([
    "inspect", "/target", "delivery-42", "--input", inspectPath,
  ], { facade: inspect.facade });
  assert.deepEqual(inspect.requests[0], {
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    deliveryId: "delivery-42",
    operation: "delivery.inspect",
    input: {
      kind: "dossier",
      dossier: "candidate",
      afterRecordId: null,
      limit: 50,
    },
  });

  const exported = recordingFacade();
  await dispatchFoundationCli([
    "export", "/target", "delivery-42", "--input", exportPath,
  ], { facade: exported.facade });
  assert.deepEqual(exported.requests[0], {
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    deliveryId: "delivery-42",
    operation: "delivery.export",
    input: {
      format: "markdown",
      selection: { kind: "dossier", dossier: "evidence" },
    },
  });

  await writeFile(inspectPath, JSON.stringify({ kind: "summary", sql: "select *" }), "utf8");
  await assert.rejects(
    dispatchFoundationCli([
      "inspect", "/target", "delivery-42", "--input", inspectPath,
    ], { facade: recordingFacade().facade }),
    (error: unknown) => error instanceof LifecycleError &&
      error.code === "cli.input" &&
      /violates the runtime protocol/u.test(error.message),
  );
});

test("semantic input rejects invalid UTF-8 and non-body Markdown before dispatch", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-v7-semantic-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "prepare.md");
  const recorded = recordingFacade();
  await writeFile(inputPath, Uint8Array.from([0xff, 0xfe]));
  await assert.rejects(
    dispatchFoundationCli([
      "prepare", "/target", "--input", inputPath,
    ], { facade: recorded.facade }),
    (error: unknown) => error instanceof LifecycleError &&
      error.code === "cli.input" &&
      /not valid UTF-8/u.test(error.message),
  );
  assert.equal(recorded.requests.length, 0);

  await writeFile(inputPath, "---\n{\"identity\":\"agent\"}\n---\n\nBody.\n", "utf8");
  await assert.rejects(
    dispatchFoundationCli([
      "prepare", "/target", "--input", inputPath,
    ], { facade: recorded.facade }),
    (error: unknown) => error instanceof LifecycleError &&
      error.code === "cli.input" &&
      /violates the runtime protocol/u.test(error.message),
  );
  assert.equal(recorded.requests.length, 0);
});

test("CLI rejects caller-authored mechanics options", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-v7-options-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "prepare.md");
  await writeFile(inputPath, "Prepare the bounded objective.\n", "utf8");
  for (const [name, value] of [
    ["delivery-id", "caller-delivery"],
    ["request-id", "caller-id"],
    ["target-id", "caller-target"],
    ["contract-digest", `sha256:${"0".repeat(64)}`],
    ["head", "a".repeat(40)],
    ["package-file", inputPath],
    ["observed-at", "2026-08-28T00:00:00.000Z"],
  ] as const) {
    await assert.rejects(
      dispatchFoundationCli([
        "prepare",
        "/target",
        "--input", inputPath,
        `--${name}`, value,
      ], { facade: recordingFacade().facade }),
      new RegExp(`Unsupported Lifecycle Foundation option\\(s\\): --${name}`, "u"),
    );
  }
});

test("initialization keeps machine authority private and rejects caller-owned mechanics", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-v7-init-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "initialize.json");
  const authorityPath = join(directory, "authority.secret");
  await writeFile(inputPath, JSON.stringify({
    targetId: "target-cli-v7",
    directorPrincipal: "director-1",
    stage: true,
  }), "utf8");
  const recorded = recordingFacade();
  await dispatchFoundationCli([
    "initialize",
    "/target",
    "--input", inputPath,
    "--authority-secret-file", authorityPath,
  ], {
    facade: recorded.facade,
    readAuthoritySecret: async () => "private-initialization-secret-at-least-thirty-two-bytes",
  });
  assert.deepEqual(recorded.requests[0], {
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    operation: "repository.initialize",
    input: {
      targetId: "target-cli-v7",
      directorPrincipal: "director-1",
      stage: true,
    },
  });
  assert.throws(() => assertFoundationAuthorityCredential(recorded.contexts[0]?.authorityCredential, "initialize"), /live credential/u);
    assert.doesNotMatch(JSON.stringify(recorded.contexts[0]), /private-|authoritySecret/u);

  await writeFile(inputPath, JSON.stringify({
    targetId: "target-cli-v7",
    home: "/caller/private-home",
    publicationDigest: `sha256:${"0".repeat(64)}`,
  }), "utf8");
  await assert.rejects(
    dispatchFoundationCli([
      "initialize",
      "/target",
      "--input", inputPath,
      "--authority-secret-file", authorityPath,
    ], {
      facade: recordingFacade().facade,
      readAuthoritySecret: async () => "secret",
    }),
    /unsupported field home/u,
  );
});

test("CLI request schema coordinate is v17", () => {
  assert.equal(FOUNDATION_RUNTIME_FACADE_SCHEMA, "lifecycle.foundation-runtime-facade.v17");
});


test("integrate delegates one exact generation without semantic, authority, parent, or strategy input", async () => {
  const expectedGeneration = `sha256:${"7".repeat(64)}`;
  const recorded = recordingFacade();
  await dispatchFoundationCli(["integrate", "/target", "delivery-integration", "--expected-generation", expectedGeneration], { facade: recorded.facade });
  assert.deepEqual(recorded.requests, [{ schema: FOUNDATION_RUNTIME_FACADE_SCHEMA, target: "/target",
    deliveryId: "delivery-integration", operation: "delivery.integrate", input: { expectedGeneration } }]);
  assert.equal(recorded.contexts[0]?.authorityCredential, undefined);
  for (const forbidden of ["input", "semantic-markdown", "authority-secret-file", "parent", "parent-commit", "canonical-parent", "strategy", "workspace-strategy"]) {
    const refused = recordingFacade();
    await assert.rejects(dispatchFoundationCli(["integrate", "/target", "delivery-integration", "--expected-generation", expectedGeneration,
      `--${forbidden}`, "/must-not-be-opened"], { facade: refused.facade }),
    (error: unknown) => error instanceof LifecycleError && error.code === "cli.option");
    assert.equal(refused.requests.length, 0, `--${forbidden} refuses before dispatch`);
  }
  const missing = recordingFacade();
  await assert.rejects(dispatchFoundationCli(["integrate", "/target", "delivery-integration"], { facade: missing.facade }), /expected-generation/u);
  assert.equal(missing.requests.length, 0);
});

// Source assertions only: Facade request/context boundary, not delegated Runtime execution.
test("work set/run/stop compile exact resource choices and references without authority custody", async context => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-work-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "permission.json");
  const generation = `sha256:${"a".repeat(64)}`;
  const reference = { kind: "work-delegation", id: "work-1", revision: 2, digest: `sha256:${"b".repeat(64)}` };
  const choice = { allowedOperations: ["delivery.continue", "delivery.evaluate", "delivery.integrate"],
    directions: { continue: "Develop the approved scope.\nPreserve exact requirements.", evaluate: "Review every admitted proposition." },
    agentChoices: { builder: { model: "model.builder", reasoning: "high" }, reviewer: { model: "model.reviewer", reasoning: "medium" } },
    ceilings: { operations: 6, agentAttempts: 4, reservedCellWallTimeMs: 14_400_000 }, expiresAt: null };
  const recorded = recordingFacade();
  let secretReads = 0;
  const options = { facade: recorded.facade, readAuthoritySecret: async () => { secretReads += 1; throw new Error("unexpected authority read"); } };
  await writeFile(inputPath, JSON.stringify(choice));
  await dispatchFoundationCli(["work", "set", "/target path", "delivery-1", "--input", inputPath,
    "--expected-generation", generation, "--format", "human"], options);
  assert.deepEqual(recorded.requests[0], { schema: FOUNDATION_RUNTIME_FACADE_SCHEMA, operation: "delivery.work",
    target: "/target path", deliveryId: "delivery-1", input: { ...choice, action: "set", expectedGeneration: generation } });
  await writeFile(inputPath, JSON.stringify(reference));
  for (const action of ["run", "stop"] as const) {
    await dispatchFoundationCli(["work", action, "/target path", "delivery-1", "--input", inputPath,
      ...(action === "run" ? ["--expected-generation", generation] : [])], options);
    assert.deepEqual(recorded.requests.at(-1), { schema: FOUNDATION_RUNTIME_FACADE_SCHEMA, operation: "delivery.work",
      target: "/target path", deliveryId: "delivery-1", input: action === "run"
        ? { action, expectedGeneration: generation, delegation: reference } : { action, delegation: reference } });
  }
  assert.equal(secretReads, 0);
  assert.deepEqual(recorded.contexts, [{}, {}, {}]);
  assert.deepEqual(foundationCliOptionNames("work", "stop"), ["input", "format"]);

  const before = recorded.requests.length;
  for (const args of [
    ["work", "auto", "/target", "delivery-1"],
    ["work", "run", "/target", "--input", inputPath, "--expected-generation", generation],
    ["work", "run", "/target", "delivery-1", "--input", inputPath],
    ["work", "stop", "/target", "delivery-1", "--input", inputPath, "--expected-generation", generation],
    ...(["set", "run", "stop"] as const).map(action => ["work", action, "/target", "delivery-1", "--input", inputPath, "--authority-secret-file", "/never-read"]),
    ["work", "stop", "/target", "delivery-1", "--input", inputPath, "--format", "other"],
  ]) await assert.rejects(dispatchFoundationCli(args, options), LifecycleError);
  for (const invalid of [
    { ...reference, kind: "director-decision" }, { ...reference, revision: 0 },
    { ...reference, digest: "sha256:short" }, { ...reference, expectedGeneration: generation },
    { delegation: reference }, { ...reference, model: "model.changed" },
  ]) {
    await writeFile(inputPath, JSON.stringify(invalid));
    await assert.rejects(dispatchFoundationCli(["work", "stop", "/target", "delivery-1", "--input", inputPath], options), /runtime protocol/u);
  }
  for (const invalid of [
    { ...choice, action: "run" }, { ...choice, expectedGeneration: generation },
    { ...choice, directions: { continue: null, evaluate: choice.directions.evaluate } },
    { ...choice, ceilings: { ...choice.ceilings, operations: -1 } },
    { ...choice, agentChoices: { ...choice.agentChoices, builder: { ...choice.agentChoices.builder, image: "not-caller-selected" } } },
  ]) {
    await writeFile(inputPath, JSON.stringify(invalid));
    await assert.rejects(dispatchFoundationCli(["work", "set", "/target", "delivery-1", "--input", inputPath,
      "--expected-generation", generation], options));
  }
  assert.equal(recorded.requests.length, before, "every refusal precedes the Facade call");
  assert.equal(secretReads, 0);
});

test("work JSON file bound preserves both independent semantic limits including worst-case JSON escaping", async context => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-work-bounds-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "permission.json");
  const choice = { allowedOperations: ["delivery.continue", "delivery.evaluate"],
    agentChoices: { builder: { model: "model.builder", reasoning: "high" }, reviewer: { model: "model.reviewer", reasoning: "high" } },
    ceilings: { operations: 2, agentAttempts: 2, reservedCellWallTimeMs: 7_200_000 }, expiresAt: null };
  const args = ["work", "set", "/target", "delivery-1", "--input", inputPath,
    "--expected-generation", `sha256:${"a".repeat(64)}`];
  const recorded = recordingFacade();
  for (const direction of ["a".repeat(600 * 1_024), "\u0001".repeat(1_048_576)]) {
    const source = JSON.stringify({ ...choice, directions: { continue: direction, evaluate: direction } });
    assert.ok(Buffer.byteLength(source) > 1_048_576, "The previous generic JSON file bound refuses this valid request");
    assert.ok(Buffer.byteLength(source) <= FOUNDATION_CLI_WORK_JSON_INPUT_MAXIMUM_BYTES);
    await writeFile(inputPath, source);
    await dispatchFoundationCli(args, { facade: recorded.facade });
    const request = recorded.requests.at(-1)!;
    assert.ok(request.operation === "delivery.work" && request.input.action === "set");
    assert.equal(request.input.directions.continue, direction);
    assert.equal(request.input.directions.evaluate, direction);
  }
  const before = recorded.requests.length;
  await writeFile(inputPath, JSON.stringify({ ...choice, directions: { continue: "a".repeat(1_048_577), evaluate: "Review." } }));
  await assert.rejects(dispatchFoundationCli(args, { facade: recorded.facade }), /runtime protocol/u);
  await writeFile(inputPath, " ".repeat(FOUNDATION_CLI_WORK_JSON_INPUT_MAXIMUM_BYTES + 1));
  await assert.rejects(dispatchFoundationCli(args, { facade: recorded.facade }), /UTF-8 bytes/u);
  assert.equal(recorded.requests.length, before);
});
