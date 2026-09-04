import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FOUNDATION_SEMANTIC_MARKDOWN_MAXIMUM_BYTES,
  parseFoundationRuntimeOperationRequest,
} from "@neutral/lifecycle-protocol";
import { LifecycleError } from "../errors.js";
import {
  FOUNDATION_RUNTIME_FACADE_SCHEMA,
  foundationRuntime,
  type FoundationRuntimeExecutionContext,
  type FoundationRuntimeFacade,
  type FoundationRuntimeInitializeInput,
  type FoundationRuntimeOperationKind,
  type FoundationRuntimeOperationRequest,
  type FoundationRuntimeOperationResult,
} from "./facade.js";
import { parseStrictJson } from "./validation/strict-json.js";
import { exactKeys, object } from "./validation/value.js";

const FOUNDATION_CLI_JSON_INPUT_MAXIMUM_BYTES = 1024 * 1024;

export const FOUNDATION_CLI_ACTION_NAMES = Object.freeze([
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
] as const);

export type FoundationCliAction = typeof FOUNDATION_CLI_ACTION_NAMES[number];
export type FoundationCliOutputFormat = "json" | "human";

const ACTION_OPERATIONS: Readonly<Record<FoundationCliAction, FoundationRuntimeOperationKind>> = Object.freeze({
  initialize: "repository.initialize",
  validate: "repository.validate",
  inbox: "delivery.inbox",
  status: "delivery.status",
  prepare: "delivery.prepare",
  admit: "delivery.admit",
  continue: "delivery.continue",
  evaluate: "delivery.evaluate",
  revise: "delivery.revise",
  reaffirm: "delivery.reaffirm",
  accept: "delivery.accept",
  "no-ship": "delivery.no-ship",
  recover: "delivery.recover",
  inspect: "delivery.inspect",
  diff: "delivery.diff",
  watch: "delivery.watch",
  export: "delivery.export",
});

const SEMANTIC_INPUT_ACTIONS = new Set<FoundationCliAction>([
  "prepare",
  "continue",
  "evaluate",
  "revise",
  "reaffirm",
  "no-ship",
]);

const AUTHORITY_SECRET_ACTIONS = new Set<FoundationCliAction>([
  "initialize",
  "admit",
  "accept",
  "no-ship",
]);

const JSON_INPUT_ACTIONS = new Set<FoundationCliAction>(["inbox", "inspect", "diff", "watch", "export"]);

const EXPECTED_GENERATION_ACTIONS = new Set<FoundationCliAction>([
  "continue",
  "evaluate",
  "revise",
  "reaffirm",
]);

const DELIVERY_ACTIONS = new Set<FoundationCliAction>([
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

const OPTIONAL_DELIVERY_ACTIONS = new Set<FoundationCliAction>(["watch"]);

export function foundationCliOptionNames(action: FoundationCliAction): readonly string[] {
  if (action === "initialize") {
    return Object.freeze(["input", "authority-secret-file", "format"]);
  }
  if (action === "validate" || action === "status" || action === "recover") {
    return Object.freeze(["format"]);
  }
  const options: string[] = [];
  if (SEMANTIC_INPUT_ACTIONS.has(action) || JSON_INPUT_ACTIONS.has(action)) options.push("input");
  if (EXPECTED_GENERATION_ACTIONS.has(action)) options.push("expected-generation");
  if (AUTHORITY_SECRET_ACTIONS.has(action)) options.push("authority-secret-file");
  options.push("format");
  return Object.freeze(options);
}

type Parsed = Readonly<{
  positionals: readonly string[];
  options: ReadonlyMap<string, string>;
}>;

function usage(message: string): never {
  throw new LifecycleError({ code: "cli.usage", message });
}

function optionFailure(message: string): never {
  throw new LifecycleError({ code: "cli.option", message });
}

function inputFailure(message: string, cause?: unknown): never {
  throw new LifecycleError({
    code: "cli.input",
    message,
    ...(cause === undefined
      ? {}
      : { observedFacts: { cause: cause instanceof Error ? cause.message : String(cause) } }),
  });
}

function parse(args: readonly string[]): Parsed {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const separator = value.indexOf("=");
    const name = separator < 0 ? value.slice(2) : value.slice(2, separator);
    if (name.length === 0 || options.has(name)) {
      optionFailure(`Invalid or repeated option --${name}`);
    }
    const next = separator < 0 ? args[index + 1] : value.slice(separator + 1);
    if (next === undefined || next.length === 0 || (separator < 0 && next.startsWith("--"))) {
      optionFailure(`Option --${name} requires a value`);
    }
    options.set(name, next);
    if (separator < 0) index += 1;
  }
  return Object.freeze({ positionals: Object.freeze(positionals), options });
}

function action(value: string | undefined): FoundationCliAction {
  if (value === undefined || !FOUNDATION_CLI_ACTION_NAMES.includes(value as FoundationCliAction)) {
    usage(value === undefined
      ? `Lifecycle Foundation requires one action: ${FOUNDATION_CLI_ACTION_NAMES.join(", ")}`
      : `Unknown Lifecycle Foundation action: ${value}. Available actions: ${FOUNDATION_CLI_ACTION_NAMES.join(", ")}.`);
  }
  return value as FoundationCliAction;
}

function required(parsed: Parsed, name: string): string {
  const value = parsed.options.get(name);
  if (value === undefined) optionFailure(`Option --${name} requires a value`);
  return value;
}

function outputFormat(parsed: Parsed): FoundationCliOutputFormat {
  const value = parsed.options.get("format") ?? "json";
  if (value !== "json" && value !== "human") optionFailure("--format must be json or human");
  return value;
}

function assertOptions(parsed: Parsed, selected: FoundationCliAction): void {
  const allowed = new Set(foundationCliOptionNames(selected));
  const unknown = [...parsed.options.keys()].filter((name) => !allowed.has(name));
  if (unknown.length > 0) {
    optionFailure(`Unsupported Lifecycle Foundation option(s): ${unknown.map((name) => `--${name}`).join(", ")}`);
  }
}

function target(parsed: Parsed, selected: FoundationCliAction): string {
  const validLength = OPTIONAL_DELIVERY_ACTIONS.has(selected)
    ? parsed.positionals.length === 2 || parsed.positionals.length === 3
    : parsed.positionals.length === (DELIVERY_ACTIONS.has(selected) ? 3 : 2);
  if (!validLength) {
    usage(OPTIONAL_DELIVERY_ACTIONS.has(selected)
      ? `Lifecycle Foundation ${selected} requires one target repository path and an optional exact Delivery identity`
      : DELIVERY_ACTIONS.has(selected)
      ? `Lifecycle Foundation ${selected} requires exactly one target repository path and one Delivery identity`
      : `Lifecycle Foundation ${selected} requires exactly one target repository path`);
  }
  return parsed.positionals[1]!;
}

function deliveryId(parsed: Parsed, selected: FoundationCliAction): string {
  if (!DELIVERY_ACTIONS.has(selected) || parsed.positionals.length !== 3) {
    usage(`Lifecycle Foundation ${selected} requires one exact Delivery identity`);
  }
  return parsed.positionals[2]!;
}

function optionalDeliveryId(parsed: Parsed, selected: FoundationCliAction): string | null {
  if (!OPTIONAL_DELIVERY_ACTIONS.has(selected)) return deliveryId(parsed, selected);
  if (parsed.positionals.length !== 2 && parsed.positionals.length !== 3) {
    usage(`Lifecycle Foundation ${selected} requires one target and an optional exact Delivery identity`);
  }
  return parsed.positionals[2] ?? null;
}

async function readInputFile(path: string, label: string, maximumBytes: number): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(resolve(path));
  } catch (error) {
    inputFailure(`Lifecycle Foundation ${label} input is unavailable`, error);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    inputFailure(`Lifecycle Foundation ${label} input must contain 1 through ${maximumBytes} UTF-8 bytes`);
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    inputFailure(`Lifecycle Foundation ${label} input is not valid UTF-8`, error);
  }
}

async function initializationInput(path: string): Promise<FoundationRuntimeInitializeInput> {
  const bytes = await readInputFile(path, "initialization", 4 * 1024 * 1024);
  const value = object(parseStrictJson(decodeUtf8(bytes, "initialization"), {
    maximumBytes: 4 * 1024 * 1024,
    source: "Lifecycle Foundation initialization input",
  }), "cli.input", "Lifecycle Foundation initialization input");
  exactKeys(
    value,
    [],
    ["targetId", "founderPrincipal", "implementationRoots", "checkBindings", "stage"],
    "cli.input",
    "Lifecycle Foundation initialization input",
  );
  return value as FoundationRuntimeInitializeInput;
}

async function semanticInput(path: string, operation: FoundationRuntimeOperationKind): Promise<string> {
  const bytes = await readInputFile(path, operation, FOUNDATION_SEMANTIC_MARKDOWN_MAXIMUM_BYTES);
  return decodeUtf8(bytes, operation);
}

async function jsonInput(path: string, operation: FoundationRuntimeOperationKind): Promise<Record<string, unknown>> {
  const bytes = await readInputFile(path, operation, FOUNDATION_CLI_JSON_INPUT_MAXIMUM_BYTES);
  const value = parseStrictJson(decodeUtf8(bytes, operation), {
    maximumBytes: FOUNDATION_CLI_JSON_INPUT_MAXIMUM_BYTES,
    source: `Lifecycle Foundation ${operation} input`,
  });
  return object(value, "cli.input", `Lifecycle Foundation ${operation} input`);
}

function exactRequest(value: unknown, selected: FoundationCliAction): FoundationRuntimeOperationRequest {
  try {
    return parseFoundationRuntimeOperationRequest(value);
  } catch (error) {
    inputFailure(`Lifecycle Foundation ${selected} input violates the runtime protocol`, error);
  }
}

async function deliveryRequest(
  selected: Exclude<FoundationCliAction, "initialize" | "validate" | "inbox" | "status" | "prepare">,
  parsed: Parsed,
): Promise<FoundationRuntimeOperationRequest> {
  const operation = ACTION_OPERATIONS[selected];
  const common = {
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: target(parsed, selected),
    deliveryId: optionalDeliveryId(parsed, selected),
    operation,
  } as const;

  if (selected === "recover") return exactRequest({ ...common, input: null }, selected);
  if (selected === "inspect" || selected === "diff" || selected === "watch") {
    return exactRequest({ ...common, input: await jsonInput(required(parsed, "input"), operation) }, selected);
  }
  if (selected === "export") {
    return exactRequest({
      ...common,
      input: {
        format: "markdown",
        selection: await jsonInput(required(parsed, "input"), operation),
      },
    }, selected);
  }

  const semanticMarkdown = SEMANTIC_INPUT_ACTIONS.has(selected)
    ? await semanticInput(required(parsed, "input"), operation)
    : undefined;

  if (selected === "no-ship") {
    return exactRequest({ ...common, input: { semanticMarkdown } }, selected);
  }
  if (selected === "admit" || selected === "accept") {
    return exactRequest({ ...common, input: null }, selected);
  }
  const expectedGeneration = parsed.options.get("expected-generation");
  return exactRequest({
    ...common,
    input: {
      semanticMarkdown,
      ...(expectedGeneration === undefined ? {} : { expectedGeneration }),
    },
  }, selected);
}

export type FoundationCliDispatch = Readonly<{
  kind: "foundation-cli-dispatch";
  format: FoundationCliOutputFormat;
  result: FoundationRuntimeOperationResult;
}>;

export function isFoundationCliDispatch(value: unknown): value is FoundationCliDispatch {
  return value !== null && typeof value === "object" &&
    (value as Partial<FoundationCliDispatch>).kind === "foundation-cli-dispatch";
}

export async function dispatchFoundationCli(
  args: readonly string[],
  options: Readonly<{
    facade?: FoundationRuntimeFacade;
    readAuthoritySecret?: (path: string) => Promise<string>;
  }> = {},
): Promise<FoundationCliDispatch> {
  const parsed = parse(args);
  const selected = action(parsed.positionals[0]);
  assertOptions(parsed, selected);
  const facade = options.facade ?? foundationRuntime;
  const readAuthoritySecret = options.readAuthoritySecret ?? (async () =>
    optionFailure("Lifecycle Foundation authority-secret file reader is unavailable"));
  let request: FoundationRuntimeOperationRequest;

  if (selected === "initialize") {
    request = exactRequest({
      schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
      target: target(parsed, selected),
      operation: "repository.initialize",
      input: await initializationInput(required(parsed, "input")),
    }, selected);
  } else if (selected === "validate") {
    request = exactRequest({
      schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
      target: target(parsed, selected),
      operation: "repository.validate",
      input: null,
    }, selected);
  } else if (selected === "inbox") {
    request = exactRequest({
      schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
      target: target(parsed, selected),
      operation: "delivery.inbox",
      input: await jsonInput(required(parsed, "input"), "delivery.inbox"),
    }, selected);
  } else if (selected === "status") {
    request = exactRequest({
      schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
      target: target(parsed, selected),
      deliveryId: deliveryId(parsed, selected),
      operation: "delivery.status",
      input: null,
    }, selected);
  } else if (selected === "prepare") {
    request = exactRequest({
      schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
      target: target(parsed, selected),
      operation: "delivery.prepare",
      input: {
        semanticMarkdown: await semanticInput(required(parsed, "input"), "delivery.prepare"),
      },
    }, selected);
  } else {
    request = await deliveryRequest(selected, parsed);
  }

  const authoritySecret = AUTHORITY_SECRET_ACTIONS.has(selected)
    ? await readAuthoritySecret(required(parsed, "authority-secret-file"))
    : undefined;
  const executionContext: FoundationRuntimeExecutionContext = authoritySecret === undefined
    ? {}
    : { authoritySecret };
  const result = await facade.execute(request, executionContext);
  return Object.freeze({
    kind: "foundation-cli-dispatch",
    format: outputFormat(parsed),
    result,
  });
}
