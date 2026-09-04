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

const EXPECTED_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  version: [],
  initialize: ["input", "authority-secret-file", "format"],
  validate: ["format"],
  inbox: ["input", "format"],
  status: ["format"],
  prepare: ["input", "format"],
  admit: ["authority-secret-file", "format"],
  continue: ["input", "expected-generation", "format"],
  evaluate: ["input", "expected-generation", "format"],
  revise: ["input", "expected-generation", "format"],
  reaffirm: ["input", "expected-generation", "format"],
  accept: ["authority-secret-file", "format"],
  "no-ship": ["input", "authority-secret-file", "format"],
  recover: ["format"],
  inspect: ["input", "format"],
  diff: ["input", "format"],
  watch: ["input", "format"],
  export: ["input", "format"],
};

const DELIVERY_COMMANDS = new Set([
  "status",
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
  assert.deepEqual(TOP_LEVEL_COMMANDS, ["version", ...FOUNDATION_CLI_ACTION_NAMES]);
  assert.deepEqual(allHelpLeafPaths(), Object.keys(EXPECTED_OPTIONS));
  const root = resolveHelp(["--help"]);
  assert.ok(root);
  for (const command of TOP_LEVEL_COMMANDS) assert.match(root, new RegExp(`\\b${command}\\b`, "u"));
  assert.match(root, /prepare creates a Delivery/u);
  assert.match(root, /Every later Delivery command requires its exact identity/u);
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
  assert.match(help("inspect"), /summary, events, dossier, or record query/u);
  assert.match(help("export"), /strict-JSON export selection/u);
  assert.match(help("export"), /derived Markdown export/u);
  assert.match(help("prepare"), /derives protocol mechanics/u);
  assert.match(
    help("recover"),
    /exact retained Activity or post-Closure Store seal\/archive/u,
  );
});

test("post-prepare Delivery commands require one exact Delivery identity", () => {
  for (const command of FOUNDATION_CLI_ACTION_NAMES) {
    if (command === "watch") {
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
      assert.match(rendered, /private runtime execution context/u, command);
      assert.match(rendered, /never a public request field, retained Control record, or output/u, command);
    } else {
      assert.doesNotMatch(rendered, /--authority-secret-file/u, command);
    }
  }
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
