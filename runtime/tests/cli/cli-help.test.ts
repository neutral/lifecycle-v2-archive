import assert from "node:assert/strict";
import test from "node:test";
import {
  allHelpExampleCommands,
  allHelpLeafPaths,
  commandOptionNames,
  resolveHelp,
  TOP_LEVEL_COMMANDS,
} from "../../src/cli-help.js";
import { FOUNDATION_CLI_ACTION_NAMES } from "../../src/foundation/cli.js";
import { parseFoundationRuntimeOperationRequest } from "@neutral/lifecycle-protocol";

const EXPECTED_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  version: [],
  authorize: ["authority-secret-file"],
  draft: ["format", "basis"],
  initialize: ["input", "authority-secret-file", "format"],
  validate: ["format"],
  inbox: ["input", "format"],
  status: ["format"],
  prepare: ["input", "format"],
  admit: ["authority-secret-file", "format"],
  continue: ["input", "expected-generation", "format"],
  integrate: ["expected-generation", "format"],
  evaluate: ["input", "expected-generation", "format"],
  revise: ["input", "expected-generation", "format"],
  reaffirm: ["input", "expected-generation", "format"],
  accept: ["authority-secret-file", "format"],
  "no-ship": ["input", "authority-secret-file", "format"],
  recover: ["format"],
  work: ["input", "expected-generation", "format"],
  inspect: ["input", "format"],
  diff: ["input", "format"],
  watch: ["input", "format"],
  export: ["input", "format"],
};

const DELIVERY_COMMANDS = new Set([
  "status",
  "admit",
  "continue",
  "integrate",
  "evaluate",
  "revise",
  "reaffirm",
  "accept",
  "no-ship",
  "recover",
  "inspect",
  "diff",
  "export",
]);

const SEMANTIC_MARKDOWN_COMMANDS = [
  "prepare",
  "continue",
  "evaluate",
  "revise",
  "reaffirm",
  "no-ship",
] as const;

const AUTHORITY_COMMANDS = new Set(["initialize", "admit", "accept", "no-ship"]);

function help(command: string): string {
  const output = resolveHelp(["help", command]);
  assert.ok(output);
  return output;
}

test("Foundation v1 is the only CLI help route", () => {
  assert.deepEqual(TOP_LEVEL_COMMANDS, ["version", "authorize", "draft", ...FOUNDATION_CLI_ACTION_NAMES]);
  assert.deepEqual(allHelpLeafPaths(), Object.keys(EXPECTED_OPTIONS).flatMap(command =>
    command === "work" ? ["work set", "work run", "work stop"] : [command]));
  const root = resolveHelp(["--help"]);
  assert.ok(root);
  for (const command of TOP_LEVEL_COMMANDS) assert.match(root, new RegExp(`\\b${command}\\b`, "u"));
  assert.match(root, /prepare creates a Delivery/u);
  assert.match(root, /Commands for one selected Delivery require its exact identity/u);
  assert.doesNotMatch(
    root,
    /\b(?:successor|method|migrate|abandon|readmit|select-no-ship|authorize-no-ship)\b/u,
  );
});

test("every direct command renders bounded deterministic contextual help", () => {
  for (const command of TOP_LEVEL_COMMANDS) {
    const explicit = help(command);
    assert.equal(explicit, resolveHelp([command, "/uninspected", "--unsupported", "--help"]));
    assert.match(explicit, new RegExp(`lifecycle ${command}\\b`, "u"));
    for (const line of explicit.split("\n")) {
      assert.ok(Array.from(line).length <= 100, `${command}: ${line}`);
    }
  }
});

test("help keeps canonical mechanics out of caller input", () => {
  const rendered = TOP_LEVEL_COMMANDS.map((command) => help(command)).join("\n");
  for (const forbidden of [
    "--request-id",
    "--target-id",
    "--contract-digest",
    "--head",
    "--package-file",
    "--observed-at",
  ]) assert.doesNotMatch(rendered, new RegExp(forbidden, "u"));
  for (const command of SEMANTIC_MARKDOWN_COMMANDS) {
    assert.match(help(command), /body-only semantic Markdown/u, command);
    assert.match(help(command), /runtime compiles canonical Control/u, command);
  }
  assert.match(help("initialize"), /strict-JSON initialization input/u);
  assert.match(help("inspect"), /strict-JSON inspection query/u);
  assert.match(help("inspect"), /Delivery, Control, context, Source, or Authorization Review query/u);
  assert.match(help("export"), /strict-JSON export selection/u);
  assert.match(help("export"), /derived Markdown export/u);
  assert.match(help("prepare"), /derives protocol mechanics/u);
  assert.match(
    help("recover"),
    /exact retained Activity or post-Closure Store seal\/archive/u,
  );
});

test("selected-Delivery commands require identity while Inbox and Inbox watch remain target-scoped", () => {
  for (const command of FOUNDATION_CLI_ACTION_NAMES) {
    if (command === "work") {
      assert.match(help(command), /lifecycle work set TARGET DELIVERY_ID --input FILE/u);
      assert.match(help(command), /exact Delivery identity returned by prepare/u);
    } else if (command === "watch") {
      assert.match(help(command), /lifecycle watch TARGET \[DELIVERY_ID\]/u);
      assert.match(help(command), /optional exact Delivery identity/u);
    } else if (DELIVERY_COMMANDS.has(command)) {
      assert.match(help(command), new RegExp(`lifecycle ${command} TARGET DELIVERY_ID`, "u"));
      assert.match(help(command), /exact Delivery identity returned by prepare/u);
    } else {
      assert.match(help(command), new RegExp(`lifecycle ${command} TARGET \\[options\\]`, "u"));
      assert.doesNotMatch(help(command), /TARGET DELIVERY_ID/u);
    }
  }
  assert.match(help("prepare"), /creates a fresh Delivery and returns its exact identity/u);
});

test("authority-secret custody is exact and outside public requests", () => {
  for (const command of FOUNDATION_CLI_ACTION_NAMES) {
    const rendered = help(command);
    if (AUTHORITY_COMMANDS.has(command)) {
      assert.match(rendered, /--authority-secret-file FILE/u, command);
      assert.match(rendered, /private authority custody/u, command);
      assert.match(rendered, /never a public request field, retained Control record, or output/u, command);
    } else {
      assert.doesNotMatch(rendered, /--authority-secret-file/u, command);
    }
  }
  assert.match(help("authorize"), /--authority-secret-file FILE/u);
  assert.match(help("authorize"), /Secret bytes never enter arguments, environment, browser HTTP, Control, or output/u);
});

test("direct action option inventories are exact, ordered, and unique", () => {
  for (const [command, expected] of Object.entries(EXPECTED_OPTIONS)) {
    const actual = commandOptionNames([command]);
    assert.deepEqual(actual, expected, command);
    assert.equal(new Set(actual).size, actual.length, `${command} repeats option metadata`);
  }
  assert.deepEqual(commandOptionNames(["successor", "validate"]), []);
  assert.deepEqual(commandOptionNames(["delivery", "continue"]), []);
});

test("help examples carry Delivery identity only where the command requires it", () => {
  assert.deepEqual(allHelpExampleCommands(), TOP_LEVEL_COMMANDS.map((command) => {
    if (command === "version") return "lifecycle version";
    if (command === "draft") return "lifecycle draft forms";
    if (command === "work") return "lifecycle work set /path/to/target DELIVERY_ID --input FILE --expected-generation SHA256";
    if (command === "authorize") {
      return "lifecycle authorize CHALLENGE --authority-secret-file FILE";
    }
    const identity = DELIVERY_COMMANDS.has(command) ? " DELIVERY_ID" : "";
    return `lifecycle ${command} /path/to/target${identity}`;
  }));
  for (const example of allHelpExampleCommands()) {
    assert.doesNotMatch(
      example,
      /lifecycle (?:successor|method|delivery|select-no-ship|authorize-no-ship) /u,
    );
  }
});


test("integration help presents only exact generation input and fixed Runtime parent selection", () => {
  assert.match(help("integrate"), /selected current canonical parent/u);
  assert.match(help("integrate"), /--expected-generation SHA256 \(required\)/u);
  assert.doesNotMatch(help("integrate"), /--(?:input|authority-secret-file|parent|strategy|workspace)/u);
});

test("read-command help supplies usable public queries and explains bounded observations", () => {
  const cases = [
    ["inspect", { kind: "delivery-view" }],
    ["inbox", { limit: 20, afterDeliveryId: null }],
    ["diff", { subject: "candidate", maximumBytes: 65536 }],
    ["watch", { scope: "delivery", afterGeneration: null, timeoutMs: 0 }],
    ["export", { format: "markdown", selection: { kind: "delivery" } }],
  ] as const;
  for (const [command, expected] of cases) {
    const example = help(command).match(/(\{[^\n]+\})/u)?.[1];
    assert.ok(example, `${command} has a complete JSON example`);
    const input: unknown = JSON.parse(example);
    assert.deepEqual(input, expected, command);
    assert.doesNotThrow(() => parseFoundationRuntimeOperationRequest({
      schema: "lifecycle.foundation-runtime-facade.v17",
      operation: `delivery.${command}`, target: "/uninspected-example-target",
      ...(command === "inbox" ? {} : { deliveryId: "delivery-example" }), input,
    }), `${command} example crosses the real public request boundary`);
  }
  assert.match(help("diff"), /unavailable diff is not an empty change/u);
  assert.match(help("watch"), /initial snapshot/u);
  assert.match(help("watch"), /Neither means the work has finished/u);
  assert.match(help("export"), /value.content/u);
});

test("work help exposes closed actions and complete structured inputs without an authority channel", () => {
  const rendered = help("work");
  for (const action of ["set", "run", "stop"]) {
    const direct = resolveHelp(["work", action, "--help"]);
    assert.equal(direct, resolveHelp(["help", "work", action]));
    assert.match(direct!, new RegExp(`lifecycle work ${action} TARGET DELIVERY_ID --input FILE`, "u"));
  }
  assert.deepEqual(commandOptionNames(["work", "set"]), ["input", "expected-generation", "format"]);
  assert.deepEqual(commandOptionNames(["work", "run"]), ["input", "expected-generation", "format"]);
  assert.deepEqual(commandOptionNames(["work", "stop"]), ["input", "format"]);
  assert.deepEqual(commandOptionNames(["work", "auto"]), []);
  assert.throws(() => resolveHelp(["help", "work", "auto"]), /set, run, or stop/u);
  const examples = [...rendered.matchAll(/^\{\n[\s\S]*?^\}/gmu)].map(match => JSON.parse(match[0]) as Record<string, unknown>);
  assert.equal(examples.length, 2);
  const reference = { ...examples[1], id: "work-1", digest: `sha256:${"b".repeat(64)}` };
  for (const action of ["set", "run", "stop"] as const) {
    const input = action === "set" ? { ...examples[0], action, expectedGeneration: `sha256:${"a".repeat(64)}` }
      : action === "run" ? { action, expectedGeneration: `sha256:${"a".repeat(64)}`, delegation: reference }
      : { action, delegation: reference };
    assert.doesNotThrow(() => parseFoundationRuntimeOperationRequest({ schema: "lifecycle.foundation-runtime-facade.v17",
      target: "/target", deliveryId: "delivery-1", operation: "delivery.work", input }));
  }
  assert.match(rendered, /Saving permission does not start work/u);
  assert.match(rendered, /Caps cover lifetime delegated reservations/u);
  assert.match(rendered, /including earlier grants and final Check Cells/u);
  assert.match(rendered, /does not promise immediate cancellation/u);
  assert.doesNotMatch(rendered, /--authority-secret-file|--image|--backend/u);
});
