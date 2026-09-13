import { LifecycleError } from "./errors.js";
import { FOUNDATION_DRAFT_HELP } from "./foundation/draft/cli.js";
import {
  FOUNDATION_CLI_ACTION_NAMES,
  FOUNDATION_CLI_WORK_ACTIONS,
  type FoundationCliWorkAction,
  foundationCliOptionNames,
  type FoundationCliAction,
} from "./foundation/cli.js";

export const TOP_LEVEL_COMMANDS = Object.freeze([
  "version",
  "authorize",
  "draft",
  ...FOUNDATION_CLI_ACTION_NAMES,
] as const);

export type TopLevelCommand = typeof TOP_LEVEL_COMMANDS[number];

const DELIVERY_COMMANDS = new Set<FoundationCliAction>([
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
  authorize: "Stream Director authority to one exact live local invocation.",
  draft: "Inspect local authoring formats and draft bytes without opening a target or changing files.",
  initialize: "Initialize one fresh target and establish Director authority.",
  validate: "Validate one initialized target without changing it.",
  inbox: "List runtime-derived Delivery standing and attention across one target.",
  status: "Observe one exact Delivery and its current derived state.",
  prepare: "Create one Delivery from a fresh Director Brief.",
  admit: "Authenticate admission or readmission of the exact current Work Boundary proposal.",
  continue: "Fund the next bounded pass on the exact current Candidate.",
  integrate: "Construct the exact integration result against the selected current canonical parent.",
  evaluate: "Seal and independently evaluate the exact integrated Candidate.",
  revise: "Propose a Work Boundary with changed mandate after a Material Condition.",
  reaffirm: "Propose a fresh Work Boundary with unchanged mandate after a Material Condition.",
  accept: "Authenticate and conditionally apply the exact evidenced Candidate over its integration parent.",
  "no-ship": "Authenticate no-ship semantics and Candidate disposition.",
  recover: "Resume only the exact retained Activity or post-Closure Store seal/archive.",
  work: "Save bounded work permission, run within it, or finish the current operation then stop.",
  inspect: "Inspect exact Delivery, Control, Candidate, Knowledge, Atlas, and authorization-review facts.",
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
  if (path.length === 2 && path[0] === "work" && FOUNDATION_CLI_WORK_ACTIONS.includes(path[1] as FoundationCliWorkAction)) {
    return foundationCliOptionNames("work", path[1] as FoundationCliWorkAction);
  }
  if (path.length === 1 && path[0] === "draft") return Object.freeze(["format", "basis"]);
  if (path.length === 1 && path[0] === "authorize") {
    return Object.freeze(["authority-secret-file"]);
  }
  if (path.length !== 1 || !FOUNDATION_CLI_ACTION_NAMES.includes(path[0] as FoundationCliAction)) {
    return Object.freeze([]);
  }
  return foundationCliOptionNames(path[0] as FoundationCliAction);
}

export function allHelpLeafPaths(): readonly string[] {
  return TOP_LEVEL_COMMANDS.flatMap(command => command === "work"
    ? FOUNDATION_CLI_WORK_ACTIONS.map(action => `work ${action}`) : [command]);
}

function conciseRootHelp(): string {
  return [
    "Lifecycle Foundation v1",
    "",
    "USAGE",
    "  lifecycle <command> ...",
    "",
    ...orientationLines(),
    "COMMON COMMANDS",
    "  initialize  Initialize one fresh target.",
    "  prepare     Create one Delivery from a fresh Director Brief.",
    "  admit       Approve the proposed scope before development starts or resumes.",
    "  inbox       Review concurrent Deliveries and required attention.",
    "  status      Observe one exact Delivery.",
    "  work        Save bounded permission; run work; finish the current operation then stop.",
    "  continue    Continue work on its Candidate with one fresh manual direction.",
    "  integrate   Construct its exact result against a selected canonical parent.",
    "  evaluate    Seal and evaluate its Candidate.",
    "  accept      Authenticate acceptance of its evidenced Candidate.",
    "  no-ship     Authenticate no-ship and Candidate disposition.",
    "  recover     Reconcile the retained interruption before starting new work.",
    "  authorize   Complete one exact local browser authority handoff.",
    "  draft       Inspect authoring formats, Knowledge lineage, and semantic drafts locally.",
    "  inspect     Inspect exact Delivery, context, source, and review facts.",
    "  diff        Show the exact runtime-selected Candidate diff.",
    "",
    "Run lifecycle --help for every command or lifecycle help <command> for exact syntax.",
    "",
  ].join("\n");
}

function orientationLines(): readonly string[] {
  return [
    "START HERE",
    "  Director sets direction and owns the required decisions; Worker gathers support and does the work.",
    "  Either role can be human or agent. The Director supplies the Director Brief for this work level.",
    "  Complete authorized work without adding a human approval step; return scope decisions to the Director.",
    "  Delivery = one governed change. Candidate = its saved proposed result.",
    "  Work Boundary = exact scope and constraints. Evidence = checks and independent review.",
    "  Canonical = the repository state into which an accepted result is applied.",
    "  Work permission = separate finite resources and standing directions under approved scope.",
    "",
    "  describe work -> approve scope -> develop -> integrate -> check result -> decide publication",
    "  prepare         admit            continue   integrate    evaluate        accept / no-ship",
    "  This is orientation. Current status determines the available actions, including correction.",
    "",
    "  New work: lifecycle help prepare",
    "  Existing work: lifecycle inbox TARGET --input QUERY_FILE --format human",
    "  One Delivery: lifecycle status TARGET DELIVERY_ID --format human",
    "  TARGET is your repository directory. Help shows each command's exact required inputs.",
    "",
  ];
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
    ...orientationLines(),
    "COMMANDS",
    ...commands,
    "",
    "DELIVERY IDENTITY",
    "  prepare creates a Delivery. Commands for one selected Delivery require its exact identity.",
    "",
    "HELP",
    "  lifecycle help <command>",
    "  lifecycle <command> --help",
    "",
  ].join("\n");
}

function usage(command: Exclude<TopLevelCommand, "version" | "draft">): string {
  if (command === "authorize") {
    return "lifecycle authorize CHALLENGE --authority-secret-file FILE";
  }
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

function optionLines(command: Exclude<TopLevelCommand, "version" | "draft">): readonly string[] {
  if (command === "authorize") {
    return [
      "  --authority-secret-file FILE (required)",
      "      Stream one owner-private Director authority secret file to the live invocation.",
    ];
  }
  return foundationCliOptionNames(command).flatMap((name) => {
    if (name === "input") return [`  --input FILE (required)`, `      ${inputDescription(command)}`];
    if (name === "authority-secret-file") {
      return [
        "  --authority-secret-file FILE (required)",
        "      Read one owner-private Director authority secret file.",
      ];
    }
    if (name === "expected-generation") {
      return [
        "  --expected-generation SHA256 (required)",
        "      Bind this request to one runtime-derived Delivery generation.",
      ];
    }
    return ["  --format json|human", "      Select canonical JSON or bounded human output; default is json."];
  });
}

function commandNotes(command: Exclude<TopLevelCommand, "version" | "draft">): readonly string[] {
  if (command === "authorize") {
    return [
      "AUTHORITY",
      "  The challenge selects one live, target-pinned review; it is not approval.",
      "  Secret bytes never enter arguments, environment, browser HTTP, Control, or output.",
      "",
      "Runtime claims once, rederives the exact review under lock, and then authenticates.",
    ];
  }
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
      "  The Director supplies semantics only; the runtime compiles canonical Control.",
      "",
    );
  } else if (command === "inspect") {
    notes.push(
      "QUERY",
      "  Select one supported Delivery, Control, context, Source, or Authorization Review query.",
      "  Exact cursors and Source References come from Runtime inspection results.",
      '  For a coherent work view, put {"kind":"delivery-view"} in the input file.',
      "  Its generation.digest is the reviewed --expected-generation for a productive action.",
      "",
    );
  } else if (command === "inbox") {
    notes.push(
      "QUERY EXAMPLE",
      '  Put {"limit":20,"afterDeliveryId":null} in the input file for the first page.',
      "  Use nextAfterDeliveryId from the result as afterDeliveryId for the next page.",
      "  Add --format human for readable work identities and attention; JSON is the default.",
      "",
    );
  } else if (command === "export") {
    notes.push(
      "SELECTION",
      "  The input selects one Delivery, dossier, or record for derived Markdown export.",
      '  For this Delivery, use {"format":"markdown","selection":{"kind":"delivery"}}.',
      "  JSON output carries the Markdown in value.content; human output reports its byte count and digest.",
      "",
    );
  } else if (command === "diff") {
    notes.push(
      "QUERY EXAMPLE",
      '  Put {"subject":"candidate","maximumBytes":65536} in the input file to inspect working changes.',
      '  Use subject "decision" to inspect the exact sealed result for a publication decision.',
      "  Add --format human to read the diff. Check its currentness and any truncation before deciding.",
      "  An unavailable diff is not an empty change. Runtime explains the missing exact subject.",
      "",
    );
  } else if (command === "watch") {
    notes.push(
      "FIRST OBSERVATION",
      '  Put {"scope":"delivery","afterGeneration":null,"timeoutMs":0} in the input file.',
      '  For the Inbox, use scope "inbox" and omit DELIVERY_ID.',
      "",
      "WAIT AGAIN",
      "  Set afterGeneration to the returned value.generation and timeoutMs to at most 60000.",
      "  A changed result can be the initial snapshot. An unchanged result only ends this bounded wait.",
      "  Neither means the work has finished; inspect the returned state before choosing an operation.",
      "",
    );
  }
  if (AUTHORITY_COMMANDS.has(command)) {
    notes.push(
      "AUTHORITY",
      "  Secret bytes enter only private authority custody.",
      "  They are never a public request field, retained Control record, or output.",
      "",
    );
  }
  if (command === "admit") {
    notes.push(
      "RESULT",
      "  Initial admission activates the exact proposal, then initializes its Candidate.",
      "  Readmission activates the resolved proposal and preserves Candidate continuity.",
      "  If interrupted, use recover to continue this transition under its retained subject.",
      "",
    );
  } else if (command === "continue") {
    notes.push(
      "CONTINUITY",
      "  Each Attempt starts from the current retained Candidate with fresh direction and Investment.",
      "  Provider failure can still leave valid useful Candidate output; inspect the resulting view.",
      "  Local correction uses continue. A frozen Material Condition requires resolution and readmission.",
      "",
    );
  } else if (command === "integrate") {
    notes.push(
      "NEXT COURSE",
      "  Integration constructs and assesses a result; it does not publish canonical bytes.",
      "  Conflict preserves the Candidate and supplies exact attempted-parent correction context.",
      "  Correct with continue, then integrate again. Resolve a frozen context Condition before evaluation.",
      "",
    );
  } else if (command === "evaluate") {
    notes.push(
      "RESULT",
      "  Evaluation requires exact integration provenance and produces support for a Director decision.",
      "  Readiness is not authorization or proof of application.",
      "  Inspect unmet obligations before continuing.",
      "",
    );
  } else if (command === "revise" || command === "reaffirm") {
    notes.push(
      "READMISSION",
      "  Resolution inspects the frozen Candidate read-only.",
      "  It proposes a complete successor Work Boundary.",
      "  After its baseline Checks establish readiness, admit authenticates readmission.",
      "  The proposal alone does not change the active mandate or authorize productive work.",
      "",
    );
  } else if (command === "accept") {
    notes.push(
      "EXACT APPLICATION",
      "  Acceptance applies the reviewed result only if the canonical parent still matches.",
      "  After a conclusive stale-parent refusal, integrate and evaluate again before fresh acceptance.",
      "  An indeterminate effect requires recover of the retained subject, not a replacement decision.",
      "",
    );
  } else if (command === "no-ship") {
    notes.push(
      "TERMINATION",
      "  Choose no-ship to end this Delivery without publishing its Candidate.",
      "  No-ship needs no acceptance-ready Evidence and does not claim useful work was completed.",
      "",
    );
  } else if (command === "recover") {
    notes.push(
      "RETAINED SUBJECT",
      "  Recovery preserves the exact plan and execution selections, including across changed defaults.",
      "  Restore temporarily unavailable required custody, then recover that same obligation.",
      "  After Closure, recovery only finishes Store disposition; it cannot change the terminal decision.",
      "",
    );
  }
  notes.push("Runtime derives protocol mechanics and revalidates live eligibility before effects.");
  return notes;
}

function commandHelp(command: TopLevelCommand): string {
  if (command === "work") return workHelp();
  if (command === "draft") return FOUNDATION_DRAFT_HELP;
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
    if (command === "draft") return "lifecycle draft forms";
    if (command === "work") return "lifecycle work set /path/to/target DELIVERY_ID --input FILE --expected-generation SHA256";
    if (command === "authorize") {
      return "lifecycle authorize CHALLENGE --authority-secret-file FILE";
    }
    const identity = DELIVERY_COMMANDS.has(command) ? " DELIVERY_ID" : "";
    return `lifecycle ${command} /path/to/target${identity}`;
  });
}

function workHelp(action?: FoundationCliWorkAction): string {
  const actions = action === undefined ? FOUNDATION_CLI_WORK_ACTIONS : [action];
  return [
    `Lifecycle work${action === undefined ? "" : ` ${action}`}`,
    "",
    "Work permission allocates finite labor under already approved scope.",
    "It does not approve scope or publication. Saving permission does not start work.",
    "",
    "USAGE",
    ...actions.map(selected => `  lifecycle work ${selected} TARGET DELIVERY_ID --input FILE${
      selected === "stop" ? "" : " --expected-generation SHA256"}`),
    "  Add --format human for explanation, or --format json for exact returned coordinates.",
    "  DELIVERY_ID is the exact Delivery identity returned by prepare.",
    "",
    ...(action === undefined || action === "set" ? [
    "SET INPUT · complete strict JSON resource choice",
    "  Choose the allowed work, lifetime caps, model IDs, and original standing directions.",
    "  Replace MODEL_ID and direction text with your explicit choices; no defaults are implied.",
    "  The example allows development, checks/review, and integration in that sorted order.",
    '{',
    '  "allowedOperations": ["delivery.continue", "delivery.evaluate", "delivery.integrate"],',
    '  "directions": {',
    '    "continue": "Develop the approved outcome and correct concrete in-scope findings.",',
    '    "evaluate": "Review every admitted proposition against exact Check observations."',
    '  },',
    '  "agentChoices": {',
    '    "builder": {"model": "MODEL_ID", "reasoning": "high"},',
    '    "reviewer": {"model": "MODEL_ID", "reasoning": "high"}',
    '  },',
    '  "ceilings": {"operations": 6, "agentAttempts": 4, "reservedCellWallTimeMs": 14400000},',
    '  "expiresAt": null',
    '}',
    "  Omit neither direction slot: use null for an Agent operation you do not allow.",
    "  Its matching agentChoices slot must also be null. Integration needs no Agent selection.",
    "  Each direction permits up to 1 MiB of UTF-8; the JSON file also accounts for escaping.",
    "  Models, finite Cell limits and availability are checked by the installed Runtime.",
    "  Caps cover lifetime delegated reservations, including earlier grants and final Check Cells.",
    "  Reserved Cell time is a conservative charge, not elapsed work time, token use or spend.",
    "  A replacement cannot erase previous charges. A new admission needs new work permission.",
    "",
    ] : []),
    ...(action !== "set" ? [
    "RUN / STOP INPUT · exact public permission reference",
    '{',
    '  "kind": "work-delegation",',
    '  "id": "COPY_RETURNED_ID",',
    '  "revision": 1,',
    '  "digest": "COPY_RETURNED_SHA256"',
    '}',
    "  Copy all four values from the saved permission; do not infer a revision or digest.",
    ] : ["  The saved result returns value.delegation, the exact public reference for run/stop.", ""]),
    ...(action !== "stop" ? [
    "  For set/run, read the current generation with inspect using this query file:",
    '  {"kind":"delivery-view"}',
    "  lifecycle inspect TARGET DELIVERY_ID --input QUERY_FILE --format json",
    "  Use value.view.generation.digest for --expected-generation. A stale selection refuses.",
    "",
    ] : []),
    "RUN / STOP BEHAVIOR",
    "  run starts one foreground course using the saved directions and reserved resources.",
    "  It returns for real decisions, scope problems, exhausted allowance or unresolved execution.",
    "  Nothing resumes automatically after the command returns or the interface reloads.",
    "  stop commits a durable no-next-reservation request for that exact permission.",
    "  A pending stop lets the current finite operation settle, including its remaining Checks.",
    "  Stop takes no generation or execution defaults and does not promise immediate cancellation.",
    "  Unknown returns require observation. Do not redispatch an uncertain operation.",
    "  These commands require no authority secret or browser authorization challenge.",
    "  Product completion comes from the returned state; acceptance stays explicitly yours.",
    "",
  ].join("\n");
}

export function resolveHelp(args: readonly string[]): string | undefined {
  if (args[0] === "help" && args[1] === "work" && args.length === 3) {
    if (!FOUNDATION_CLI_WORK_ACTIONS.includes(args[2] as FoundationCliWorkAction)) {
      throw new LifecycleError({ code: "cli.usage", message: "Work help accepts set, run, or stop" });
    }
    return workHelp(args[2] as FoundationCliWorkAction);
  }
  if (args[0] === "work" && FOUNDATION_CLI_WORK_ACTIONS.includes(args[1] as FoundationCliWorkAction) &&
      args.some(value => value === "--help" || value === "-h")) return workHelp(args[1] as FoundationCliWorkAction);

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
  return command === "work" && FOUNDATION_CLI_WORK_ACTIONS.includes(args[1] as FoundationCliWorkAction)
    ? `lifecycle help work ${args[1]}` : isTopLevelCommand(command) ? `lifecycle help ${command}` : "lifecycle --help";
}
