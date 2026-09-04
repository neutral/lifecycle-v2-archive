import { LifecycleError } from "./errors.js";
import {
  FOUNDATION_CLI_ACTION_NAMES,
  foundationCliOptionNames,
  type FoundationCliAction,
} from "./foundation/cli.js";

export const TOP_LEVEL_COMMANDS = Object.freeze([
  "version",
  ...FOUNDATION_CLI_ACTION_NAMES,
] as const);

export type TopLevelCommand = typeof TOP_LEVEL_COMMANDS[number];

const DELIVERY_COMMANDS = new Set<FoundationCliAction>([
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

const OPTIONAL_DELIVERY_COMMANDS = new Set<FoundationCliAction>(["watch"]);

const SEMANTIC_MARKDOWN_COMMANDS = new Set<FoundationCliAction>([
  "prepare",
  "continue",
  "evaluate",
  "revise",
  "reaffirm",
  "no-ship",
]);

const AUTHORITY_COMMANDS = new Set<FoundationCliAction>([
  "initialize",
  "admit",
  "accept",
  "no-ship",
]);

const DESCRIPTIONS: Readonly<Record<TopLevelCommand, string>> = Object.freeze({
  version: "Report the installed Lifecycle Foundation runtime identity.",
  initialize: "Initialize one fresh target and establish Founder authority.",
  validate: "Validate one initialized target without changing it.",
  inbox: "List runtime-derived Delivery standing and attention across one target.",
  status: "Observe one exact Delivery and its current derived state.",
  prepare: "Create one Delivery from a fresh Founder Brief.",
  admit: "Authenticate the prepared boundary and initialize its Candidate.",
  continue: "Fund the next bounded pass on the exact current Candidate.",
  evaluate: "Seal and independently evaluate the exact current Candidate.",
  revise: "Propose a changed boundary after a Material Condition.",
  reaffirm: "Propose the unchanged boundary after a Material Condition.",
  accept: "Authenticate acceptance of the exact evidenced Candidate.",
  "no-ship": "Authenticate no-ship semantics and Candidate disposition.",
  recover: "Resume only the exact retained Activity or post-Closure Store seal/archive.",
  inspect: "Query exact retained Control facts for one Delivery.",
  diff: "Render the exact runtime-selected Candidate or decision diff.",
  watch: "Wait for one exact Delivery or Inbox generation change.",
  export: "Render a derived Markdown view of selected Delivery Control.",
});

function isTopLevelCommand(value: string | undefined): value is TopLevelCommand {
  return value !== undefined && TOP_LEVEL_COMMANDS.includes(value as TopLevelCommand);
}

function distance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex]! + 1,
        previous[rightIndex + 1]! + 1,
        previous[rightIndex]! + (left[leftIndex] === right[rightIndex] ? 0 : 1),
      ));
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

export function closestSuggestion(value: string, candidates: readonly string[]): string | undefined {
  const ranked = candidates
    .map((candidate) => ({ candidate, distance: distance(value, candidate) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate));
  const selected = ranked[0];
  return selected !== undefined && selected.distance <= Math.max(2, Math.floor(value.length / 3))
    ? selected.candidate
    : undefined;
}

export function commandOptionNames(path: readonly string[]): readonly string[] {
  if (path.length !== 1 || !FOUNDATION_CLI_ACTION_NAMES.includes(path[0] as FoundationCliAction)) {
    return Object.freeze([]);
  }
  return foundationCliOptionNames(path[0] as FoundationCliAction);
}

export function allHelpLeafPaths(): readonly string[] {
  return TOP_LEVEL_COMMANDS;
}

function conciseRootHelp(): string {
  return [
    "Lifecycle Foundation v1",
    "",
    "USAGE",
    "  lifecycle <command> ...",
    "",
    "COMMON COMMANDS",
    "  initialize  Initialize one fresh target.",
    "  prepare     Create one Delivery from a fresh Founder Brief.",
    "  inbox       Review concurrent Deliveries and required attention.",
    "  status      Observe one exact Delivery.",
    "  continue    Continue work on its Candidate.",
    "  evaluate    Seal and evaluate its Candidate.",
    "  accept      Authenticate acceptance of its evidenced Candidate.",
    "  no-ship     Authenticate no-ship and Candidate disposition.",
    "  inspect     Query exact retained Control facts.",
    "  diff        Show the exact runtime-selected Candidate diff.",
    "",
    "Run lifecycle --help for every command or lifecycle help <command> for exact syntax.",
    "",
  ].join("\n");
}

function fullRootHelp(): string {
  const commands = TOP_LEVEL_COMMANDS.flatMap((command) => [
    `  ${command.padEnd(10)} ${DESCRIPTIONS[command]}`,
  ]);
  return [
    "Lifecycle Foundation v1",
    "",
    "USAGE",
    "  lifecycle <command> ...",
    "",
    "COMMANDS",
    ...commands,
    "",
    "DELIVERY IDENTITY",
    "  prepare creates a Delivery. Every later Delivery command requires its exact identity.",
    "",
    "HELP",
    "  lifecycle help <command>",
    "  lifecycle <command> --help",
    "",
  ].join("\n");
}

function usage(command: FoundationCliAction): string {
  return OPTIONAL_DELIVERY_COMMANDS.has(command)
    ? `lifecycle ${command} TARGET [DELIVERY_ID] [options]`
    : DELIVERY_COMMANDS.has(command)
    ? `lifecycle ${command} TARGET DELIVERY_ID [options]`
    : `lifecycle ${command} TARGET [options]`;
}

function inputDescription(command: FoundationCliAction): string {
  if (command === "initialize") return "Read the exact strict-JSON initialization input from FILE.";
  if (command === "inbox") return "Read one bounded strict-JSON Inbox query from FILE.";
  if (command === "inspect") return "Read one exact strict-JSON inspection query from FILE.";
  if (command === "diff") return "Read one exact strict-JSON diff selection from FILE.";
  if (command === "watch") return "Read one bounded strict-JSON watch selection from FILE.";
  if (command === "export") return "Read one exact strict-JSON export selection from FILE.";
  return "Read one complete body-only semantic Markdown input from FILE.";
}

function optionLines(command: FoundationCliAction): readonly string[] {
  return foundationCliOptionNames(command).flatMap((name) => {
    if (name === "input") return [`  --input FILE (required)`, `      ${inputDescription(command)}`];
    if (name === "authority-secret-file") {
      return [
        "  --authority-secret-file FILE (required)",
        "      Read one owner-private Founder authority secret file.",
      ];
    }
    if (name === "expected-generation") {
      return [
        "  --expected-generation SHA256",
        "      Bind semantic input to one runtime-derived Delivery generation; direct CLI may omit it.",
      ];
    }
    return ["  --format json|human", "      Select canonical JSON or bounded human output; default is json."];
  });
}

function commandNotes(command: FoundationCliAction): readonly string[] {
  const notes: string[] = [];
  if (DELIVERY_COMMANDS.has(command) || OPTIONAL_DELIVERY_COMMANDS.has(command)) {
    notes.push(
      "DELIVERY IDENTITY",
      OPTIONAL_DELIVERY_COMMANDS.has(command)
        ? "  DELIVERY_ID is an optional exact Delivery identity; omit it only for Inbox watch."
        : "  DELIVERY_ID is the exact Delivery identity returned by prepare.",
      "",
    );
  } else if (command === "prepare") {
    notes.push(
      "DELIVERY IDENTITY",
      "  prepare creates a fresh Delivery and returns its exact identity.",
      "",
    );
  }
  if (SEMANTIC_MARKDOWN_COMMANDS.has(command)) {
    notes.push(
      "SEMANTIC INPUT",
      "  The Founder supplies semantics only; the runtime compiles canonical Control.",
      "",
    );
  } else if (command === "inspect") {
    notes.push(
      "QUERY",
      "  The input is exactly one summary, events, dossier, or record query.",
      "",
    );
  } else if (command === "export") {
    notes.push(
      "SELECTION",
      "  The input selects one Delivery, dossier, or record for derived Markdown export.",
      "",
    );
  }
  if (AUTHORITY_COMMANDS.has(command)) {
    notes.push(
      "AUTHORITY",
      "  Secret bytes enter only the private runtime execution context.",
      "  They are never a public request field, retained Control record, or output.",
      "",
    );
  }
  notes.push("Runtime derives protocol mechanics and revalidates live eligibility before effects.");
  return notes;
}

function commandHelp(command: TopLevelCommand): string {
  if (command === "version") {
    return [
      "Lifecycle Foundation v1 runtime identity",
      "",
      "USAGE",
      "  lifecycle version",
      "",
      "DESCRIPTION",
      `  ${DESCRIPTIONS.version}`,
      "",
    ].join("\n");
  }
  return [
    `Lifecycle ${command}`,
    "",
    "USAGE",
    `  ${usage(command)}`,
    "",
    "DESCRIPTION",
    `  ${DESCRIPTIONS[command]}`,
    "",
    "OPTIONS",
    ...optionLines(command),
    "",
    ...commandNotes(command),
    "",
  ].join("\n");
}

export function allHelpExampleCommands(): readonly string[] {
  return TOP_LEVEL_COMMANDS.map((command) => {
    if (command === "version") return "lifecycle version";
    const identity = DELIVERY_COMMANDS.has(command) ? " DELIVERY_ID" : "";
    return `lifecycle ${command} /path/to/target${identity}`;
  });
}

export function resolveHelp(args: readonly string[]): string | undefined {
  if (args.length === 0) return conciseRootHelp();
  if (args[0] === "help") {
    if (args.length === 1) return fullRootHelp();
    if (args.length > 2) {
      throw new LifecycleError({ code: "cli.usage", message: "Help accepts exactly one command name" });
    }
    if (!isTopLevelCommand(args[1])) {
      const suggestion = closestSuggestion(args[1]!, TOP_LEVEL_COMMANDS);
      throw new LifecycleError({
        code: "cli.usage",
        message: `Unknown help command: ${args[1]}.${suggestion ? ` Did you mean ${suggestion}?` : ""}`,
      });
    }
    return commandHelp(args[1]);
  }
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return fullRootHelp();
  if (isTopLevelCommand(args[0]) && args.some((value) => value === "--help" || value === "-h")) {
    return commandHelp(args[0]);
  }
  return undefined;
}

export function contextualHelpCommand(args: readonly string[]): string {
  const command = args[0];
  return isTopLevelCommand(command) ? `lifecycle help ${command}` : "lifecycle --help";
}
