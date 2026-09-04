import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LifecycleError } from "../../src/errors.js";
import {
  FOUNDATION_CLI_ACTION_NAMES,
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

test("CLI exposes only the v8 operation and option surface", async () => {
  assert.deepEqual(FOUNDATION_CLI_ACTION_NAMES, [
    "initialize",
    "validate",
    "inbox",
    "status",
    "prepare",
    "admit",
    "continue",
    "evaluate",
    "revise",
    "reaffirm",
    "accept",
    "no-ship",
    "recover",
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
  const markdown = "# Founder Brief\n\nPrepare one exact Work Boundary proposal.\n";
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

test("status and every post-prepare operation require one exact Delivery identity", async (context) => {
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

test("validate, semantic Delivery work, and recovery use their exact v7 inputs", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-v7-inputs-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const semanticPath = join(directory, "brief.md");
  const semanticMarkdown = "# Founder Brief\n\nPerform one bounded Delivery activity.\n";
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
      selected, "/target", "delivery-42", "--input", semanticPath,
    ], { facade: recorded.facade });
    assert.deepEqual(recorded.requests[0], {
      schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
      target: "/target",
      deliveryId: "delivery-42",
      operation: expectedOperation,
      input: { semanticMarkdown },
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

test("authority operations keep secret bytes only in the ephemeral execution context", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-cli-v7-authority-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const semanticPath = join(directory, "no-ship.md");
  const authorityPath = join(directory, "authority.secret");
  const semanticMarkdown = "# Founder Decision\n\nDo not ship this Delivery.\n";
  await writeFile(semanticPath, semanticMarkdown, "utf8");
  const readAuthoritySecret = async (path: string): Promise<string> => {
    assert.equal(path, authorityPath);
    return "private-founder-secret";
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
    assert.deepEqual(recorded.contexts[0], {
      authoritySecret: "private-founder-secret",
    });
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
  assert.deepEqual(noShip.contexts[0], {
    authoritySecret: "private-founder-secret",
  });
  assert.equal("authoritySecret" in noShip.requests[0]!, false);
  assert.doesNotMatch(JSON.stringify(noShip.requests[0]), /authorityProof/u);
});

test("inspect and export compile strict JSON selections into exact v7 queries", async (context) => {
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
    founderPrincipal: "founder-1",
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
    readAuthoritySecret: async () => "private-initialization-secret",
  });
  assert.deepEqual(recorded.requests[0], {
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    operation: "repository.initialize",
    input: {
      targetId: "target-cli-v7",
      founderPrincipal: "founder-1",
      stage: true,
    },
  });
  assert.deepEqual(recorded.contexts[0], {
    authoritySecret: "private-initialization-secret",
  });

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

test("CLI request schema coordinate is v10", () => {
  assert.equal(FOUNDATION_RUNTIME_FACADE_SCHEMA, "lifecycle.foundation-runtime-facade.v10");
});
