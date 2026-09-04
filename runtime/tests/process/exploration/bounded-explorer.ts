/**
 * Deterministic bounded breadth-first exploration for synchronous test systems.
 *
 * The explorer deliberately has no Lifecycle imports and performs no semantic
 * state deduplication. Its completeness boundary is therefore the exact seed,
 * command alphabet, and depth supplied by each scenario.
 */

export const BOUNDED_EXPLORATION_CONTRACT_VERSION =
  "lifecycle.bounded-exploration.contract.v1" as const;
export const BOUNDED_EXPLORATION_REPORT_FORMAT =
  "lifecycle.bounded-exploration.report.v1" as const;

export type ExplorationClause = Readonly<{
  id: string;
  owner: string;
  classification: string;
  statement: string;
}>;

export type AcceptedExpectation<Model> = Readonly<{
  kind: "accepted";
  next: Model;
}>;

export type RefusedExpectation = Readonly<{
  kind: "refused";
  /** Null is survey-only: it accepts any coded refusal and blocks gate readiness. */
  classes: readonly string[] | null;
}>;

export type TransitionExpectation<Model> =
  | AcceptedExpectation<Model>
  | RefusedExpectation;

export type ForkableSystem<System> = Readonly<{
  fork(): System;
}>;

export type ExplorationCommand<System, Model> = Readonly<{
  id: string;
  expectation(model: Model): TransitionExpectation<Model>;
  apply(system: System, trace: readonly string[]): void;
}>;

export type ExplorationSeed<System, Model> = Readonly<{
  id: string;
  system: System;
  model: Model;
}>;

export type ExplorationFinding = string | Readonly<Record<string, unknown>>;

export type ExplorationScenario<System extends ForkableSystem<System>, Model, Observation> =
  Readonly<{
    /** Omission selects the current contract; an explicit value must match exactly. */
    contractVersion?: string;
    id: string;
    clauses: readonly ExplorationClause[];
    bounds: Readonly<{
      maxDepth: number;
      maxNodes: number;
      maxTransitions: number;
    }>;
    requiredCoverage?: Readonly<{
      phases?: readonly string[];
      acceptedCommands?: readonly string[];
      eventKinds?: readonly string[];
      seedEventKinds?: readonly string[];
      generatedEventKinds?: readonly string[];
      recoveryCoordinates?: readonly string[];
    }>;
    seeds: readonly ExplorationSeed<System, Model>[];
    commands: readonly ExplorationCommand<System, Model>[];
    observe(system: System): Observation;
    invariants(input: Readonly<{
      model: Model;
      observation: Observation;
      trace: readonly string[];
      seedId: string;
    }>): readonly ExplorationFinding[];
    fingerprint?(system: System): unknown;
  }>;

export type ExplorationFindingWitness = Readonly<{
  signature: string;
  source: "invariant" | "transition";
  seedId: string;
  depth: number;
  trace: readonly string[];
  finding: ExplorationFinding;
}>;

export type ExplorationReport = Readonly<{
  contractVersion: typeof BOUNDED_EXPLORATION_CONTRACT_VERSION;
  reportFormat: typeof BOUNDED_EXPLORATION_REPORT_FORMAT;
  scenarioId: string;
  clauses: readonly ExplorationClause[];
  bounds: Readonly<{
    maxDepth: number;
    maxNodes: number;
    maxTransitions: number;
  }>;
  dedupeMode: "none";
  seeds: readonly string[];
  commands: readonly string[];
  transitions: Readonly<{
    attempted: number;
    accepted: number;
    refused: number;
    expectationMismatches: number;
    oracleBlockedAccepted: number;
    unclassifiedRefusalExpectations: number;
  }>;
  refusalCodes: readonly Readonly<{
    code: string;
    count: number;
    shortest: Readonly<{
      seedId: string;
      depth: number;
      trace: readonly string[];
      message: string;
    }> | null;
  }>[];
  normalizedSemanticObservations: Readonly<{
    count: number;
    values: readonly Readonly<{
      signature: string;
      semantic: unknown;
      seedId: string;
      depth: number;
      trace: readonly string[];
    }>[];
  }>;
  depths: readonly Readonly<{
    depth: number;
    nodes: number;
    expanded: number;
    frontier: number;
    attempted: number;
    accepted: number;
    refused: number;
    findings: number;
  }>[];
  maximumDepthReached: number;
  frontier: Readonly<{
    depth: number;
    nodes: number;
    truncated: boolean;
  }>;
  coverage: Readonly<{
    commands: readonly Readonly<{
      id: string;
      attempted: number;
      accepted: number;
      refused: number;
    }>[];
    eventKinds: Readonly<{
      all: readonly string[] | null;
      seed: readonly string[] | null;
      generated: readonly string[] | null;
    }>;
    recoveryCoordinates: readonly string[] | null;
    modelPhases: readonly string[];
    requirements: Readonly<{
      declared: Readonly<{
        phases: readonly string[];
        acceptedCommands: readonly string[];
        eventKinds: readonly string[];
        seedEventKinds: readonly string[];
        generatedEventKinds: readonly string[];
        recoveryCoordinates: readonly string[];
      }>;
      missing: Readonly<{
        phases: readonly string[];
        acceptedCommands: readonly string[];
        eventKinds: readonly string[];
        seedEventKinds: readonly string[];
        generatedEventKinds: readonly string[];
        recoveryCoordinates: readonly string[];
      }>;
      satisfied: boolean;
    }>;
  }>;
  findings: readonly ExplorationFindingWitness[];
}>;

type JsonObject = Record<string, unknown>;

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function stableValue(value: unknown, stack: Set<object>): unknown {
  if (value === null) return null;

  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return value;
  if (kind === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Stable JSON requires finite numbers");
    }
    return value;
  }
  if (kind === "bigint") throw new TypeError("Stable JSON cannot encode bigint values");
  if (kind === "undefined" || kind === "function" || kind === "symbol") {
    throw new TypeError(`Stable JSON cannot encode ${kind} values`);
  }
  if (kind !== "object") return value;

  const retained = value as object;
  const toJson = (retained as { toJSON?: unknown }).toJSON;
  if (typeof toJson === "function") {
    const selected = (toJson as (key: string) => unknown).call(retained, "");
    if (selected !== value) return stableValue(selected, stack);
  }
  if (stack.has(retained)) throw new TypeError("Stable JSON cannot encode cyclic values");
  stack.add(retained);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((entry) => stableValue(entry, stack) ?? null);
  } else {
    const object = value as JsonObject;
    const selected: JsonObject = {};
    for (const key of Object.keys(object).sort()) {
      const entry = stableValue(object[key], stack);
      if (entry !== undefined) selected[key] = entry;
    }
    result = selected;
  }

  stack.delete(retained);
  return result;
}

/** Serialize JSON-compatible data with recursively sorted object keys. */
export function stableJson(value: unknown): string {
  const result = JSON.stringify(stableValue(value, new Set<object>()));
  if (result === undefined) {
    throw new TypeError("Stable JSON requires a serializable root value");
  }
  return result;
}

function harnessFailure(message: string, cause?: unknown): never {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = "ExplorationHarnessError";
  throw error;
}

function assertPlainObject(value: unknown, label: string): asserts value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    harnessFailure(`${label} must be an object`);
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    harnessFailure(`${label} must be a non-empty string`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    harnessFailure(`${label} must be a non-negative integer`);
  }
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") harnessFailure(`${label} must be a boolean`);
}

function validatedIdentifierArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) harnessFailure(`${label} must be an array`);
  const selected = value as unknown[];
  for (const [index, entry] of selected.entries()) {
    assertIdentifier(entry, `${label}[${index}]`);
  }
  if (new Set(selected).size !== selected.length) {
    harnessFailure(`${label} must not contain duplicates`);
  }
  return selected as string[];
}

function validatedCanonicalIdentifierArray(
  value: unknown,
  label: string,
): readonly string[] {
  const selected = validatedIdentifierArray(value, label);
  if (stableJson(selected) !== stableJson([...selected].sort())) {
    harnessFailure(`${label} must be sorted`);
  }
  return selected;
}

function validatedNullableCanonicalIdentifierArray(
  value: unknown,
  label: string,
): readonly string[] | null {
  return value === null ? null : validatedCanonicalIdentifierArray(value, label);
}

function validateWitnessCoordinates(
  value: JsonObject,
  label: string,
  seedIds: ReadonlySet<string>,
  commandIds: ReadonlySet<string>,
  maxDepth: number,
): Readonly<{ seedId: string; depth: number; trace: readonly string[] }> {
  assertIdentifier(value.seedId, `${label}.seedId`);
  if (!seedIds.has(value.seedId)) {
    harnessFailure(`${label} names undeclared seed ${value.seedId}`);
  }
  assertNonNegativeInteger(value.depth, `${label}.depth`);
  if (value.depth > maxDepth) harnessFailure(`${label}.depth exceeds maxDepth`);
  if (!Array.isArray(value.trace)) harnessFailure(`${label}.trace must be an array`);
  for (const [index, rawCommand] of value.trace.entries()) {
    assertIdentifier(rawCommand, `${label}.trace[${index}]`);
    if (!commandIds.has(rawCommand)) {
      harnessFailure(`${label} names undeclared command ${rawCommand}`);
    }
  }
  if (value.depth !== value.trace.length) {
    harnessFailure(`${label}.depth must equal trace length`);
  }
  return Object.freeze({
    seedId: value.seedId,
    depth: value.depth,
    trace: value.trace as readonly string[],
  });
}

function syncResult<Value>(value: Value, label: string): Value {
  if (
    value !== null && typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    harnessFailure(`${label} returned a Promise; the exploration contract is synchronous`);
  }
  return value;
}

function callHarness<Value>(label: string, operation: () => Value): Value {
  try {
    return syncResult(operation(), label);
  } catch (error) {
    if (error instanceof Error && error.name === "ExplorationHarnessError") throw error;
    return harnessFailure(`${label} failed`, error);
  }
}

function codedError(error: unknown): string | null {
  return error !== null && typeof error === "object" &&
      typeof (error as { code?: unknown }).code === "string" &&
      (error as { code: string }).code.length > 0
    ? (error as { code: string }).code
    : null;
}

function matchesRefusalClass(code: string, classes: readonly string[] | null): boolean {
  if (classes === null) return true;
  return classes.includes(code);
}

function refusalExpectationDescription(classes: readonly string[] | null): string {
  return classes === null ? "refused:any-coded" : `refused:${classes.join("|")}`;
}

function expectationFor<System, Model>(
  command: ExplorationCommand<System, Model>,
  model: Model,
): TransitionExpectation<Model> {
  const expectation = callHarness(
    `Command ${command.id} expectation`,
    () => command.expectation(model),
  );
  assertPlainObject(expectation, `Command ${command.id} expectation`);
  if (expectation.kind === "accepted") {
    if (!hasOwn(expectation, "next")) {
      harnessFailure(`Accepted expectation for ${command.id} must provide next`);
    }
    return expectation as AcceptedExpectation<Model>;
  }
  if (expectation.kind === "refused") {
    if (expectation.classes === null) {
      return Object.freeze({ kind: "refused", classes: null });
    }
    if (
      !Array.isArray(expectation.classes) || expectation.classes.length === 0 ||
      expectation.classes.some((value) => typeof value !== "string" || value.length === 0)
    ) {
      harnessFailure(`Refused expectation for ${command.id} must provide refusal classes`);
    }
    if (new Set(expectation.classes).size !== expectation.classes.length) {
      harnessFailure(`Refused expectation for ${command.id} must not repeat refusal classes`);
    }
    return Object.freeze({
      kind: "refused",
      classes: Object.freeze([...new Set(expectation.classes)].sort()),
    });
  }
  return harnessFailure(`Command ${command.id} returned an unsupported expectation kind`);
}

function semanticProjection(observation: unknown): unknown {
  if (observation !== null && typeof observation === "object") {
    if (hasOwn(observation, "semantic")) {
      return (observation as { semantic: unknown }).semantic;
    }
    if (hasOwn(observation, "normalizedSemantic")) {
      return (observation as { normalizedSemantic: unknown }).normalizedSemantic;
    }
  }
  return observation;
}

function optionalCoverage(
  observation: unknown,
  names: readonly string[],
  label: string,
): string[] | null {
  if (observation === null || typeof observation !== "object") return null;
  const name = names.find((candidate) => hasOwn(observation, candidate));
  if (name === undefined) return null;
  const values = (observation as JsonObject)[name];
  if (!Array.isArray(values)) harnessFailure(`Observation ${label} must be an array`);
  return values.map((value) => typeof value === "string" ? value : stableJson(value));
}

function stableWitness(seedId: string, trace: readonly string[]): string {
  return stableJson({ seedId, trace });
}

function findingSignature(finding: ExplorationFinding): string {
  if (typeof finding === "string") return finding;
  assertPlainObject(finding, "Invariant finding");
  for (const key of ["signature", "id", "code", "clause"]) {
    if (typeof finding[key] === "string" && finding[key].length > 0) {
      return finding[key];
    }
  }
  return stableJson(finding);
}

function validateFindingTraceability(
  finding: ExplorationFinding,
  source: "invariant" | "transition",
  scenarioId: string,
  clauseIds: ReadonlySet<string>,
): void {
  if (typeof finding === "string") {
    assertIdentifier(finding, `${source} finding`);
    return;
  }

  assertPlainObject(finding, `${source} finding`);
  // Reports are JSON artifacts. Validate the complete value before retaining
  // it so undefined values, cycles, and other non-JSON state fail at origin.
  stableJson(finding);
  if (source === "transition") return;

  const propertyId = finding.propertyId;
  assertIdentifier(propertyId, "Structured invariant finding propertyId");
  if (!clauseIds.has(propertyId)) {
    harnessFailure(
      `Structured invariant finding propertyId ${propertyId} is not declared by scenario ` +
        scenarioId,
    );
  }
}

function validateScenario<System extends ForkableSystem<System>, Model, Observation>(
  scenario: ExplorationScenario<System, Model, Observation>,
): Readonly<{
  scenario: ExplorationScenario<System, Model, Observation>;
  seeds: readonly ExplorationSeed<System, Model>[];
  commands: readonly ExplorationCommand<System, Model>[];
  requiredCoverage: Readonly<{
    phases: readonly string[];
    acceptedCommands: readonly string[];
    eventKinds: readonly string[];
    seedEventKinds: readonly string[];
    generatedEventKinds: readonly string[];
    recoveryCoordinates: readonly string[];
  }>;
}> {
  assertPlainObject(scenario, "Scenario");
  if (
    scenario.contractVersion !== undefined &&
    scenario.contractVersion !== BOUNDED_EXPLORATION_CONTRACT_VERSION
  ) {
    harnessFailure(
      `Scenario contractVersion must be ${BOUNDED_EXPLORATION_CONTRACT_VERSION}`,
    );
  }
  assertIdentifier(scenario.id, "Scenario id");
  if (!Array.isArray(scenario.clauses)) harnessFailure("Scenario clauses must be an array");
  const clauseIds = new Set<string>();
  for (const [index, clause] of scenario.clauses.entries()) {
    assertPlainObject(clause, `Scenario clause ${index}`);
    const id = clause.id;
    assertIdentifier(id, `Scenario clause ${index} id`);
    if (clauseIds.has(id)) harnessFailure(`Scenario repeats clause id ${id}`);
    clauseIds.add(id);
    for (const field of ["owner", "classification", "statement"] as const) {
      assertIdentifier(clause[field], `Scenario clause ${id} ${field}`);
    }
  }
  assertPlainObject(scenario.bounds, "Scenario bounds");
  if (!Number.isInteger(scenario.bounds.maxDepth) || scenario.bounds.maxDepth < 0) {
    harnessFailure("Scenario bounds.maxDepth must be a non-negative integer");
  }
  for (const name of ["maxNodes", "maxTransitions"] as const) {
    if (!Number.isInteger(scenario.bounds[name]) || scenario.bounds[name] < 1) {
      harnessFailure(`Scenario bounds.${name} must be a positive integer`);
    }
  }
  if (!Array.isArray(scenario.seeds) || scenario.seeds.length === 0) {
    harnessFailure("Scenario must provide at least one seed");
  }
  if (!Array.isArray(scenario.commands) || scenario.commands.length === 0) {
    harnessFailure("Scenario must provide at least one command");
  }
  if (typeof scenario.observe !== "function") harnessFailure("Scenario observe must be a function");
  if (typeof scenario.invariants !== "function") {
    harnessFailure("Scenario invariants must be a function");
  }
  if (scenario.fingerprint !== undefined && typeof scenario.fingerprint !== "function") {
    harnessFailure("Scenario fingerprint must be a function when provided");
  }

  const requiredCoverage = scenario.requiredCoverage ?? {};
  assertPlainObject(requiredCoverage, "Scenario requiredCoverage");
  for (const name of [
    "phases",
    "acceptedCommands",
    "eventKinds",
    "seedEventKinds",
    "generatedEventKinds",
    "recoveryCoordinates",
  ] as const) {
    const selected = requiredCoverage[name] ?? [];
    if (
      !Array.isArray(selected) ||
      selected.some((entry) => typeof entry !== "string" || entry.length === 0)
    ) {
      harnessFailure(`Scenario requiredCoverage.${name} must be a string array`);
    }
    if (new Set(selected).size !== selected.length) {
      harnessFailure(`Scenario requiredCoverage.${name} must not contain duplicates`);
    }
  }

  const seedIds = new Set<string>();
  const seeds = [...scenario.seeds].map((seed, index) => {
    const rawSeed: unknown = seed;
    assertPlainObject(rawSeed, `Scenario seed ${index}`);
    const id = seed.id;
    assertIdentifier(id, `Scenario seed ${index} id`);
    if (seedIds.has(id)) harnessFailure(`Scenario repeats seed id ${id}`);
    seedIds.add(id);
    if (
      seed.system === null || typeof seed.system !== "object" ||
      typeof seed.system.fork !== "function"
    ) {
      harnessFailure(`Scenario seed ${id} system must expose fork()`);
    }
    if (!hasOwn(seed, "model")) harnessFailure(`Scenario seed ${id} must provide model`);
    return seed;
  }).sort((left, right) => left.id.localeCompare(right.id));

  const commandIds = new Set<string>();
  const commands = [...scenario.commands].map((command, index) => {
    const rawCommand: unknown = command;
    assertPlainObject(rawCommand, `Scenario command ${index}`);
    const id = command.id;
    assertIdentifier(id, `Scenario command ${index} id`);
    if (commandIds.has(id)) harnessFailure(`Scenario repeats command id ${id}`);
    commandIds.add(id);
    if (typeof command.expectation !== "function") {
      harnessFailure(`Scenario command ${id} expectation must be a function`);
    }
    if (typeof command.apply !== "function") {
      harnessFailure(`Scenario command ${id} apply must be a function`);
    }
    return command;
  }).sort((left, right) => left.id.localeCompare(right.id));

  for (const id of requiredCoverage.acceptedCommands ?? []) {
    if (!commandIds.has(id)) {
      harnessFailure(
        `Scenario requiredCoverage.acceptedCommands names undeclared command ${id}`,
      );
    }
  }
  const declaredEventKinds = new Set(requiredCoverage.eventKinds ?? []);
  for (const name of ["seedEventKinds", "generatedEventKinds"] as const) {
    for (const eventKind of requiredCoverage[name] ?? []) {
      if (!declaredEventKinds.has(eventKind)) {
        harnessFailure(
          `Scenario requiredCoverage.${name} names ${eventKind} outside eventKinds`,
        );
      }
    }
  }

  return Object.freeze({
    scenario,
    seeds,
    commands,
    requiredCoverage: Object.freeze({
      phases: Object.freeze([...(requiredCoverage.phases ?? [])].sort()),
      acceptedCommands: Object.freeze([
        ...(requiredCoverage.acceptedCommands ?? []),
      ].sort()),
      eventKinds: Object.freeze([...(requiredCoverage.eventKinds ?? [])].sort()),
      seedEventKinds: Object.freeze([
        ...(requiredCoverage.seedEventKinds ?? []),
      ].sort()),
      generatedEventKinds: Object.freeze([
        ...(requiredCoverage.generatedEventKinds ?? []),
      ].sort()),
      recoveryCoordinates: Object.freeze([
        ...(requiredCoverage.recoveryCoordinates ?? []),
      ].sort()),
    }),
  });
}

/**
 * Validate the versioned, JSON-facing invariants of an exploration report.
 *
 * This is intentionally narrower than a publication schema. It protects the
 * generic engine's current report contract and arithmetic while formal report
 * schemas remain deferred.
 */
export function validateExplorationReport(value: unknown): ExplorationReport {
  assertPlainObject(value, "Exploration report");
  if (value.contractVersion !== BOUNDED_EXPLORATION_CONTRACT_VERSION) {
    harnessFailure(
      `Exploration report contractVersion must be ` +
        BOUNDED_EXPLORATION_CONTRACT_VERSION,
    );
  }
  if (value.reportFormat !== BOUNDED_EXPLORATION_REPORT_FORMAT) {
    harnessFailure(
      `Exploration report reportFormat must be ${BOUNDED_EXPLORATION_REPORT_FORMAT}`,
    );
  }
  assertIdentifier(value.scenarioId, "Exploration report scenarioId");

  if (!Array.isArray(value.clauses)) {
    harnessFailure("Exploration report clauses must be an array");
  }
  const clauseIds = new Set<string>();
  for (const [index, rawClause] of value.clauses.entries()) {
    assertPlainObject(rawClause, `Exploration report clause ${index}`);
    assertIdentifier(rawClause.id, `Exploration report clause ${index} id`);
    if (clauseIds.has(rawClause.id)) {
      harnessFailure(`Exploration report repeats clause id ${rawClause.id}`);
    }
    clauseIds.add(rawClause.id);
    for (const field of ["owner", "classification", "statement"] as const) {
      assertIdentifier(
        rawClause[field],
        `Exploration report clause ${rawClause.id} ${field}`,
      );
    }
  }

  assertPlainObject(value.bounds, "Exploration report bounds");
  for (const name of ["maxDepth", "maxNodes", "maxTransitions"] as const) {
    assertNonNegativeInteger(value.bounds[name], `Exploration report bounds.${name}`);
  }
  const bounds = value.bounds as unknown as ExplorationReport["bounds"];
  if (bounds.maxNodes === 0 || bounds.maxTransitions === 0) {
    harnessFailure("Exploration report node and transition bounds must be positive");
  }
  if (value.dedupeMode !== "none") {
    harnessFailure("Exploration report dedupeMode must be none");
  }
  const seeds = validatedIdentifierArray(value.seeds, "Exploration report seeds");
  const commands = validatedIdentifierArray(value.commands, "Exploration report commands");
  if (seeds.length === 0) harnessFailure("Exploration report must name at least one seed");
  if (commands.length === 0) harnessFailure("Exploration report must name at least one command");
  const seedIds = new Set(seeds);
  const commandIds = new Set(commands);

  assertPlainObject(value.transitions, "Exploration report transitions");
  for (const name of [
    "attempted",
    "accepted",
    "refused",
    "expectationMismatches",
    "oracleBlockedAccepted",
    "unclassifiedRefusalExpectations",
  ] as const) {
    assertNonNegativeInteger(
      value.transitions[name],
      `Exploration report transitions.${name}`,
    );
  }
  const transitions = value.transitions as unknown as ExplorationReport["transitions"];
  if (transitions.attempted !== transitions.accepted + transitions.refused) {
    harnessFailure("Exploration report attempted transitions must equal accepted plus refused");
  }
  if (transitions.expectationMismatches > transitions.attempted) {
    harnessFailure("Exploration report expectation mismatches exceed attempted transitions");
  }
  if (transitions.oracleBlockedAccepted > transitions.expectationMismatches) {
    harnessFailure("Exploration report oracle-blocked accepts exceed expectation mismatches");
  }
  if (transitions.oracleBlockedAccepted > transitions.accepted) {
    harnessFailure("Exploration report oracle-blocked accepts exceed accepted transitions");
  }
  if (transitions.unclassifiedRefusalExpectations > transitions.attempted) {
    harnessFailure("Exploration report unclassified refusals exceed attempted transitions");
  }

  assertNonNegativeInteger(
    value.maximumDepthReached,
    "Exploration report maximumDepthReached",
  );
  if (value.maximumDepthReached > bounds.maxDepth) {
    harnessFailure("Exploration report maximumDepthReached exceeds maxDepth");
  }
  assertPlainObject(value.frontier, "Exploration report frontier");
  assertNonNegativeInteger(value.frontier.depth, "Exploration report frontier.depth");
  assertNonNegativeInteger(value.frontier.nodes, "Exploration report frontier.nodes");
  assertBoolean(value.frontier.truncated, "Exploration report frontier.truncated");
  if (value.frontier.depth !== bounds.maxDepth) {
    harnessFailure("Exploration report frontier depth must equal maxDepth");
  }
  if (value.frontier.truncated !== (value.frontier.nodes > 0)) {
    harnessFailure("Exploration report frontier truncation must agree with its node count");
  }

  if (!Array.isArray(value.refusalCodes)) {
    harnessFailure("Exploration report refusalCodes must be an array");
  }
  if (!Array.isArray(value.depths)) {
    harnessFailure("Exploration report depths must be an array");
  }
  if (value.depths.length === 0) {
    harnessFailure("Exploration report depths must include depth zero");
  }

  const depthMetrics = new Map<number, ExplorationReport["depths"][number]>();
  let depthNodes = 0;
  let depthAttempted = 0;
  let depthAccepted = 0;
  let depthRefused = 0;
  let depthFindings = 0;
  let expectedMaximumDepthReached = 0;
  for (const [index, rawDepth] of value.depths.entries()) {
    assertPlainObject(rawDepth, `Exploration report depth ${index}`);
    for (const name of [
      "depth",
      "nodes",
      "expanded",
      "frontier",
      "attempted",
      "accepted",
      "refused",
      "findings",
    ] as const) {
      assertNonNegativeInteger(rawDepth[name], `Exploration report depth ${index}.${name}`);
    }
    const metric = rawDepth as unknown as ExplorationReport["depths"][number];
    if (metric.depth !== index) {
      harnessFailure("Exploration report depth metrics must be contiguous and ordered from zero");
    }
    if (metric.depth > bounds.maxDepth) {
      harnessFailure(`Exploration report depth ${metric.depth} exceeds maxDepth`);
    }
    if (metric.attempted !== metric.accepted + metric.refused) {
      harnessFailure(`Exploration report depth ${metric.depth} has inconsistent transitions`);
    }
    if (metric.expanded + metric.frontier !== metric.nodes) {
      harnessFailure(`Exploration report depth ${metric.depth} has inconsistent node disposition`);
    }
    if (metric.depth < bounds.maxDepth && metric.frontier !== 0) {
      harnessFailure(`Exploration report depth ${metric.depth} cannot contain frontier nodes`);
    }
    if (metric.depth === bounds.maxDepth && metric.expanded !== 0) {
      harnessFailure(`Exploration report maximum depth ${metric.depth} cannot be expanded`);
    }
    if (metric.depth === 0) {
      if (metric.nodes !== seeds.length) {
        harnessFailure("Exploration report depth zero nodes must equal seed count");
      }
      if (metric.attempted !== 0) {
        harnessFailure("Exploration report depth zero cannot contain transitions");
      }
    } else {
      const previous = depthMetrics.get(metric.depth - 1);
      if (previous === undefined) {
        harnessFailure(`Exploration report depth ${metric.depth} has no preceding depth`);
      }
      if (metric.attempted !== previous.expanded * commands.length) {
        harnessFailure(
          `Exploration report depth ${metric.depth} attempts do not match expanded nodes`,
        );
      }
      if (metric.nodes > metric.accepted) {
        harnessFailure(`Exploration report depth ${metric.depth} nodes exceed accepts`);
      }
    }
    if (metric.accepted > 0) expectedMaximumDepthReached = metric.depth;
    depthMetrics.set(metric.depth, metric);
    depthNodes += metric.nodes;
    depthAttempted += metric.attempted;
    depthAccepted += metric.accepted;
    depthRefused += metric.refused;
    depthFindings += metric.findings;
  }
  if (depthNodes > bounds.maxNodes) {
    harnessFailure("Exploration report nodes exceed maxNodes");
  }
  if (depthAttempted > bounds.maxTransitions) {
    harnessFailure("Exploration report depth attempts exceed maxTransitions");
  }
  if (
    depthAttempted !== transitions.attempted ||
    depthAccepted !== transitions.accepted ||
    depthRefused !== transitions.refused
  ) {
    harnessFailure("Exploration report depth transition totals are inconsistent");
  }
  const queuedAccepted = [...depthMetrics.values()]
    .filter(({ depth: selectedDepth }) => selectedDepth > 0)
    .reduce((sum, metric) => sum + metric.nodes, 0);
  if (transitions.accepted - queuedAccepted !== transitions.oracleBlockedAccepted) {
    harnessFailure("Exploration report accepted-node arithmetic is inconsistent");
  }
  if (value.maximumDepthReached !== expectedMaximumDepthReached) {
    harnessFailure("Exploration report maximumDepthReached is inconsistent with accepts");
  }
  const frontierNodes = [...depthMetrics.values()]
    .reduce((sum, metric) => sum + metric.frontier, 0);
  if (value.frontier.nodes !== frontierNodes) {
    harnessFailure("Exploration report frontier nodes are inconsistent with depth metrics");
  }

  const refusalCodeIds = new Set<string>();
  let refusalCount = 0;
  let previousRefusalCode: string | null = null;
  for (const [index, rawRefusal] of value.refusalCodes.entries()) {
    assertPlainObject(rawRefusal, `Exploration report refusal code ${index}`);
    assertIdentifier(rawRefusal.code, `Exploration report refusal code ${index}.code`);
    if (refusalCodeIds.has(rawRefusal.code)) {
      harnessFailure(`Exploration report repeats refusal code ${rawRefusal.code}`);
    }
    if (previousRefusalCode !== null && previousRefusalCode.localeCompare(rawRefusal.code) >= 0) {
      harnessFailure("Exploration report refusal codes must be sorted");
    }
    refusalCodeIds.add(rawRefusal.code);
    previousRefusalCode = rawRefusal.code;
    assertNonNegativeInteger(
      rawRefusal.count,
      `Exploration report refusal code ${rawRefusal.code}.count`,
    );
    if (rawRefusal.count === 0) {
      harnessFailure(
        `Exploration report refusal code ${rawRefusal.code} must have a positive count`,
      );
    }
    refusalCount += rawRefusal.count;
    if (rawRefusal.shortest === null) {
      harnessFailure(`Exploration report refusal code ${rawRefusal.code} must have a witness`);
    }
    assertPlainObject(
      rawRefusal.shortest,
      `Exploration report refusal code ${rawRefusal.code}.shortest`,
    );
    const witness = validateWitnessCoordinates(
      rawRefusal.shortest,
      `Exploration report refusal code ${rawRefusal.code}.shortest`,
      seedIds,
      commandIds,
      bounds.maxDepth,
    );
    if (witness.depth === 0 || (depthMetrics.get(witness.depth)?.refused ?? 0) === 0) {
      harnessFailure(
        `Exploration report refusal code ${rawRefusal.code} witness has no refusal at its depth`,
      );
    }
    if (typeof rawRefusal.shortest.message !== "string") {
      harnessFailure(
        `Exploration report refusal code ${rawRefusal.code}.shortest.message must be a string`,
      );
    }
  }
  if (refusalCount !== transitions.refused) {
    harnessFailure("Exploration report refusal code counts are inconsistent with transitions");
  }

  assertPlainObject(
    value.normalizedSemanticObservations,
    "Exploration report normalizedSemanticObservations",
  );
  assertNonNegativeInteger(
    value.normalizedSemanticObservations.count,
    "Exploration report normalizedSemanticObservations.count",
  );
  if (!Array.isArray(value.normalizedSemanticObservations.values)) {
    harnessFailure("Exploration report normalizedSemanticObservations.values must be an array");
  }
  if (
    value.normalizedSemanticObservations.count !==
      value.normalizedSemanticObservations.values.length
  ) {
    harnessFailure("Exploration report semantic observation count is inconsistent");
  }
  if (value.normalizedSemanticObservations.count === 0) {
    harnessFailure("Exploration report must include a normalized semantic observation");
  }
  if (
    value.normalizedSemanticObservations.count >
      seeds.length + transitions.accepted
  ) {
    harnessFailure("Exploration report semantic observations exceed actual observations");
  }
  const semanticSignatures = new Set<string>();
  let previousSemanticSignature: string | null = null;
  for (const [index, rawObservation] of
    value.normalizedSemanticObservations.values.entries()) {
    assertPlainObject(rawObservation, `Exploration report semantic observation ${index}`);
    assertIdentifier(
      rawObservation.signature,
      `Exploration report semantic observation ${index}.signature`,
    );
    if (semanticSignatures.has(rawObservation.signature)) {
      harnessFailure(
        `Exploration report repeats semantic observation signature ${rawObservation.signature}`,
      );
    }
    if (
      previousSemanticSignature !== null &&
      previousSemanticSignature.localeCompare(rawObservation.signature) >= 0
    ) {
      harnessFailure("Exploration report semantic observations must be sorted by signature");
    }
    semanticSignatures.add(rawObservation.signature);
    previousSemanticSignature = rawObservation.signature;
    if (!hasOwn(rawObservation, "semantic")) {
      harnessFailure(
        `Exploration report semantic observation ${rawObservation.signature} must include semantic`,
      );
    }
    if (stableJson(rawObservation.semantic) !== rawObservation.signature) {
      harnessFailure(
        `Exploration report semantic observation ${rawObservation.signature} ` +
          "has inconsistent signature",
      );
    }
    const witness = validateWitnessCoordinates(
      rawObservation,
      `Exploration report semantic observation ${rawObservation.signature}`,
      seedIds,
      commandIds,
      bounds.maxDepth,
    );
    const witnessDepth = depthMetrics.get(witness.depth);
    if (
      witnessDepth === undefined ||
      (witness.depth === 0 ? witnessDepth.nodes === 0 : witnessDepth.accepted === 0)
    ) {
      harnessFailure(
        `Exploration report semantic observation ${rawObservation.signature} ` +
          "has no observation at its depth",
      );
    }
  }

  assertPlainObject(value.coverage, "Exploration report coverage");
  if (!Array.isArray(value.coverage.commands)) {
    harnessFailure("Exploration report coverage.commands must be an array");
  }
  const coverageCommandIds = new Set<string>();
  const acceptedCommandIds = new Set<string>();
  let coverageAttempted = 0;
  let coverageAccepted = 0;
  let coverageRefused = 0;
  for (const [index, rawMetric] of value.coverage.commands.entries()) {
    assertPlainObject(rawMetric, `Exploration report command coverage ${index}`);
    assertIdentifier(rawMetric.id, `Exploration report command coverage ${index} id`);
    if (coverageCommandIds.has(rawMetric.id)) {
      harnessFailure(`Exploration report repeats command coverage id ${rawMetric.id}`);
    }
    coverageCommandIds.add(rawMetric.id);
    for (const name of ["attempted", "accepted", "refused"] as const) {
      assertNonNegativeInteger(
        rawMetric[name],
        `Exploration report command coverage ${rawMetric.id}.${name}`,
      );
    }
    const metric = rawMetric as unknown as ExplorationReport["coverage"]["commands"][number];
    if (metric.attempted !== metric.accepted + metric.refused) {
      harnessFailure(
        `Exploration report command coverage ${rawMetric.id} has inconsistent counts`,
      );
    }
    coverageAttempted += metric.attempted;
    coverageAccepted += metric.accepted;
    coverageRefused += metric.refused;
    if (metric.accepted > 0) acceptedCommandIds.add(metric.id);
  }
  if (
    stableJson([...coverageCommandIds].sort()) !== stableJson([...commands].sort()) ||
    coverageAttempted !== transitions.attempted ||
    coverageAccepted !== transitions.accepted ||
    coverageRefused !== transitions.refused
  ) {
    harnessFailure("Exploration report command coverage is inconsistent with transitions");
  }

  assertPlainObject(value.coverage.eventKinds, "Exploration report coverage.eventKinds");
  const coveredEventKinds = validatedNullableCanonicalIdentifierArray(
    value.coverage.eventKinds.all,
    "Exploration report coverage.eventKinds.all",
  );
  const coveredSeedEventKinds = validatedNullableCanonicalIdentifierArray(
    value.coverage.eventKinds.seed,
    "Exploration report coverage.eventKinds.seed",
  );
  const coveredGeneratedEventKinds = validatedNullableCanonicalIdentifierArray(
    value.coverage.eventKinds.generated,
    "Exploration report coverage.eventKinds.generated",
  );
  const coveredEventKindSet = coveredEventKinds === null
    ? null
    : new Set(coveredEventKinds);
  if (
    coveredEventKindSet !== null &&
    [...(coveredSeedEventKinds ?? []), ...(coveredGeneratedEventKinds ?? [])]
      .some((eventKind) => !coveredEventKindSet.has(eventKind))
  ) {
    harnessFailure("Exploration report seed/generated event coverage must be included in all");
  }
  if (
    coveredEventKinds !== null &&
    coveredSeedEventKinds !== null &&
    coveredGeneratedEventKinds !== null
  ) {
    const coveredEventKindUnion = [...new Set([
      ...coveredSeedEventKinds,
      ...coveredGeneratedEventKinds,
    ])].sort();
    if (stableJson(coveredEventKinds) !== stableJson(coveredEventKindUnion)) {
      harnessFailure(
        "Exploration report all event coverage must equal seed/generated coverage",
      );
    }
  }
  const coveredRecoveryCoordinates = validatedNullableCanonicalIdentifierArray(
    value.coverage.recoveryCoordinates,
    "Exploration report coverage.recoveryCoordinates",
  );
  const coveredModelPhases = validatedCanonicalIdentifierArray(
    value.coverage.modelPhases,
    "Exploration report coverage.modelPhases",
  );
  if (coveredModelPhases.length > seeds.length + transitions.accepted) {
    harnessFailure("Exploration report model phases exceed actual model observations");
  }

  assertPlainObject(value.coverage.requirements, "Exploration report coverage.requirements");
  assertPlainObject(
    value.coverage.requirements.declared,
    "Exploration report coverage.requirements.declared",
  );
  assertPlainObject(
    value.coverage.requirements.missing,
    "Exploration report coverage.requirements.missing",
  );
  const coverageNames = [
    "phases",
    "acceptedCommands",
    "eventKinds",
    "seedEventKinds",
    "generatedEventKinds",
    "recoveryCoordinates",
  ] as const;
  const declaredCoverage = new Map<typeof coverageNames[number], readonly string[]>();
  const missingCoverage = new Map<typeof coverageNames[number], readonly string[]>();
  for (const name of coverageNames) {
    const declared = validatedCanonicalIdentifierArray(
      value.coverage.requirements.declared[name],
      `Exploration report declared coverage ${name}`,
    );
    const missing = validatedCanonicalIdentifierArray(
      value.coverage.requirements.missing[name],
      `Exploration report missing coverage ${name}`,
    );
    const declaredSet = new Set(declared);
    if (missing.some((entry) => !declaredSet.has(entry))) {
      harnessFailure(`Exploration report missing ${name} is not a subset of declared coverage`);
    }
    declaredCoverage.set(name, declared);
    missingCoverage.set(name, missing);
  }
  const declaredAcceptedCommands = declaredCoverage.get("acceptedCommands")!;
  if (declaredAcceptedCommands.some((command) => !commandIds.has(command))) {
    harnessFailure("Exploration report declared acceptedCommands names undeclared commands");
  }
  const declaredEventKindSet = new Set(declaredCoverage.get("eventKinds")!);
  for (const name of ["seedEventKinds", "generatedEventKinds"] as const) {
    if (declaredCoverage.get(name)!.some((eventKind) => !declaredEventKindSet.has(eventKind))) {
      harnessFailure(`Exploration report declared ${name} falls outside eventKinds`);
    }
  }
  const observedCoverage = new Map<typeof coverageNames[number], ReadonlySet<string>>([
    ["phases", new Set(coveredModelPhases)],
    ["acceptedCommands", acceptedCommandIds],
    ["eventKinds", new Set(coveredEventKinds ?? [])],
    ["seedEventKinds", new Set(coveredSeedEventKinds ?? [])],
    ["generatedEventKinds", new Set(coveredGeneratedEventKinds ?? [])],
    ["recoveryCoordinates", new Set(coveredRecoveryCoordinates ?? [])],
  ]);
  for (const name of coverageNames) {
    const expectedMissing = declaredCoverage.get(name)!
      .filter((entry) => !observedCoverage.get(name)!.has(entry));
    if (stableJson(missingCoverage.get(name)) !== stableJson(expectedMissing)) {
      harnessFailure(`Exploration report missing ${name} is inconsistent with observed coverage`);
    }
  }
  const coverageSatisfied = [...missingCoverage.values()]
    .every((entries) => entries.length === 0);
  assertBoolean(
    value.coverage.requirements.satisfied,
    "Exploration report coverage.requirements.satisfied",
  );
  if (value.coverage.requirements.satisfied !== coverageSatisfied) {
    harnessFailure("Exploration report coverage satisfaction is inconsistent");
  }

  if (!Array.isArray(value.findings)) {
    harnessFailure("Exploration report findings must be an array");
  }
  const findingSignatures = new Set<string>();
  for (const [index, rawWitness] of value.findings.entries()) {
    assertPlainObject(rawWitness, `Exploration report finding ${index}`);
    assertIdentifier(rawWitness.signature, `Exploration report finding ${index} signature`);
    if (findingSignatures.has(rawWitness.signature)) {
      harnessFailure(`Exploration report repeats finding signature ${rawWitness.signature}`);
    }
    findingSignatures.add(rawWitness.signature);
    if (rawWitness.source !== "invariant" && rawWitness.source !== "transition") {
      harnessFailure(`Exploration report finding ${rawWitness.signature} has invalid source`);
    }
    assertIdentifier(rawWitness.seedId, `Exploration report finding ${rawWitness.signature} seedId`);
    if (!seedIds.has(rawWitness.seedId)) {
      harnessFailure(
        `Exploration report finding ${rawWitness.signature} names undeclared seed ` +
          rawWitness.seedId,
      );
    }
    assertNonNegativeInteger(
      rawWitness.depth,
      `Exploration report finding ${rawWitness.signature} depth`,
    );
    if (!Array.isArray(rawWitness.trace)) {
      harnessFailure(`Exploration report finding ${rawWitness.signature} trace must be an array`);
    }
    for (const [traceIndex, command] of rawWitness.trace.entries()) {
      assertIdentifier(
        command,
        `Exploration report finding ${rawWitness.signature} trace[${traceIndex}]`,
      );
      if (!commands.includes(command)) {
        harnessFailure(
          `Exploration report finding ${rawWitness.signature} names undeclared command ${command}`,
        );
      }
    }
    if (rawWitness.depth !== rawWitness.trace.length) {
      harnessFailure(`Exploration report finding ${rawWitness.signature} depth is inconsistent`);
    }
    if (
      rawWitness.depth > bounds.maxDepth ||
      (depthMetrics.get(rawWitness.depth)?.findings ?? 0) === 0
    ) {
      harnessFailure(
        `Exploration report finding ${rawWitness.signature} has no finding at its depth`,
      );
    }
    validateFindingTraceability(
      rawWitness.finding as ExplorationFinding,
      rawWitness.source,
      value.scenarioId,
      clauseIds,
    );
    if (findingSignature(rawWitness.finding as ExplorationFinding) !== rawWitness.signature) {
      harnessFailure(`Exploration report finding ${rawWitness.signature} signature is inconsistent`);
    }
  }
  if (depthFindings < value.findings.length) {
    harnessFailure("Exploration report depth finding counts are inconsistent");
  }
  if (value.findings.length === 0 && depthFindings !== 0) {
    harnessFailure("Exploration report depth finding counts have no finding witnesses");
  }

  // This also rejects cycles, undefined fields, and other non-JSON report data.
  stableJson(value);
  return value as unknown as ExplorationReport;
}

/**
 * Exhaustively explore every command suffix through maxDepth.
 *
 * This intentionally performs no semantic-state deduplication. A node is an
 * exact seed plus command suffix, so the frontier and completeness boundary
 * remain explicit.
 */
export function exploreScenario<
  System extends ForkableSystem<System>,
  Model,
  Observation,
>(input: ExplorationScenario<System, Model, Observation>): ExplorationReport {
  const { scenario, seeds, commands, requiredCoverage } = validateScenario(input);
  const { maxDepth, maxNodes, maxTransitions } = scenario.bounds;
  const clauseIds = new Set(scenario.clauses.map(({ id }) => id));
  type Node = Readonly<{
    seedId: string;
    system: System;
    model: Model;
    observation: Observation;
    trace: readonly string[];
    depth: number;
  }>;
  type DepthMetric = {
    depth: number;
    nodes: number;
    expanded: number;
    frontier: number;
    attempted: number;
    accepted: number;
    refused: number;
    findings: number;
  };
  type CommandMetric = { attempted: number; accepted: number; refused: number };
  type RefusalMetric = {
    count: number;
    shortest: ExplorationReport["refusalCodes"][number]["shortest"];
  };
  const queue: Node[] = [];
  const depthMetrics = new Map<number, DepthMetric>();
  const commandMetrics = new Map<string, CommandMetric>(commands.map(({ id }) => [id, {
    attempted: 0,
    accepted: 0,
    refused: 0,
  }]));
  const refusalMetrics = new Map<string, RefusalMetric>();
  const semanticObservations = new Map<string, ExplorationReport[
    "normalizedSemanticObservations"
  ]["values"][number]>();
  const findings = new Map<string, ExplorationFindingWitness>();
  const eventKinds = new Set<string>();
  const seedEventKinds = new Set<string>();
  const generatedEventKinds = new Set<string>();
  const recoveryCoordinates = new Set<string>();
  const modelPhases = new Set<string>();
  let eventCoverageProvided = false;
  let seedEventCoverageProvided = false;
  let generatedEventCoverageProvided = false;
  let recoveryCoverageProvided = false;
  let attempted = 0;
  let accepted = 0;
  let refused = 0;
  let expectationMismatches = 0;
  let oracleBlockedAccepted = 0;
  let unclassifiedRefusalExpectations = 0;
  let maximumDepthReached = 0;

  const depth = (value: number): DepthMetric => {
    let selected = depthMetrics.get(value);
    if (selected === undefined) {
      selected = {
        depth: value,
        nodes: 0,
        expanded: 0,
        frontier: 0,
        attempted: 0,
        accepted: 0,
        refused: 0,
        findings: 0,
      };
      depthMetrics.set(value, selected);
    }
    return selected;
  };

  const recordFinding = (
    finding: ExplorationFinding,
    context: Readonly<{ seedId: string; trace: readonly string[] }>,
    source: "invariant" | "transition" = "invariant",
  ): void => {
    validateFindingTraceability(finding, source, scenario.id, clauseIds);
    const signature = findingSignature(finding);
    const candidate = Object.freeze({
      signature,
      source,
      seedId: context.seedId,
      depth: context.trace.length,
      trace: Object.freeze([...context.trace]),
      finding,
    });
    const retained = findings.get(signature);
    if (
      retained === undefined || candidate.depth < retained.depth ||
      (candidate.depth === retained.depth &&
        stableWitness(candidate.seedId, candidate.trace) <
          stableWitness(retained.seedId, retained.trace))
    ) {
      findings.set(signature, candidate);
    }
    depth(candidate.depth).findings += 1;
  };

  const recordObservation = (
    observation: Observation,
    context: Readonly<{ seedId: string; trace: readonly string[] }>,
  ): void => {
    const semantic = semanticProjection(observation);
    const signature = stableJson(semantic);
    const candidate = Object.freeze({
      signature,
      semantic,
      seedId: context.seedId,
      depth: context.trace.length,
      trace: Object.freeze([...context.trace]),
    });
    const retained = semanticObservations.get(signature);
    if (
      retained === undefined || candidate.depth < retained.depth ||
      (candidate.depth === retained.depth &&
        stableWitness(candidate.seedId, candidate.trace) <
          stableWitness(retained.seedId, retained.trace))
    ) {
      semanticObservations.set(signature, candidate);
    }

    const observedEvents = optionalCoverage(observation, ["eventKinds"], "eventKinds");
    if (observedEvents !== null) {
      eventCoverageProvided = true;
      for (const eventKind of observedEvents) eventKinds.add(eventKind);
    }
    const observedSeedEvents = optionalCoverage(
      observation,
      ["seedEventKinds"],
      "seedEventKinds",
    );
    if (observedSeedEvents !== null) {
      seedEventCoverageProvided = true;
      for (const eventKind of observedSeedEvents) seedEventKinds.add(eventKind);
    }
    const observedGeneratedEvents = optionalCoverage(
      observation,
      ["generatedEventKinds"],
      "generatedEventKinds",
    );
    if (observedGeneratedEvents !== null) {
      generatedEventCoverageProvided = true;
      for (const eventKind of observedGeneratedEvents) generatedEventKinds.add(eventKind);
    }
    const observedRecoveries = optionalCoverage(
      observation,
      ["recoveryCoordinates", "recoveries"],
      "recoveryCoordinates",
    );
    if (observedRecoveries !== null) {
      recoveryCoverageProvided = true;
      for (const coordinate of observedRecoveries) recoveryCoordinates.add(coordinate);
    }
  };

  const recordModel = (model: Model): void => {
    const phase = (model as unknown as { phase?: unknown } | null)?.phase;
    if (
      model !== null && typeof model === "object" &&
      typeof phase === "string" && phase.length > 0
    ) {
      modelPhases.add(phase);
    }
  };

  const systemFingerprint = (
    system: System,
    observation: Observation,
    label: string,
  ): unknown => callHarness(
    label,
    () => scenario.fingerprint === undefined ? observation : scenario.fingerprint(system),
  );

  const runInvariants = (node: Node): void => {
    const selected = callHarness(
      `Scenario invariants at ${node.seedId}:${node.trace.join(",")}`,
      () => scenario.invariants(Object.freeze({
        model: node.model,
        observation: node.observation,
        trace: node.trace,
        seedId: node.seedId,
      })),
    );
    if (!Array.isArray(selected)) harnessFailure("Scenario invariants must return an array");
    for (const finding of selected) recordFinding(finding, node);
  };

  for (const seed of seeds) {
    if (queue.length >= maxNodes) {
      harnessFailure(`Scenario ${scenario.id} exceeded bounds.maxNodes`);
    }
    const trace = Object.freeze([]) as readonly string[];
    const observation = callHarness(
      `Scenario seed ${seed.id} observation`,
      () => scenario.observe(seed.system),
    );
    const node = Object.freeze({
      seedId: seed.id,
      system: seed.system,
      model: seed.model,
      observation,
      trace,
      depth: 0,
    });
    depth(0).nodes += 1;
    recordObservation(observation, node);
    recordModel(seed.model);
    runInvariants(node);
    queue.push(node);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor]!;
    if (node.depth === maxDepth) {
      depth(node.depth).frontier += 1;
      continue;
    }
    depth(node.depth).expanded += 1;

    for (const command of commands) {
      if (attempted >= maxTransitions) {
        harnessFailure(`Scenario ${scenario.id} exceeded bounds.maxTransitions`);
      }
      const nextDepth = node.depth + 1;
      const nextTrace = Object.freeze([...node.trace, command.id]);
      const context = Object.freeze({ seedId: node.seedId, trace: nextTrace });
      const expected = expectationFor(command, node.model);
      if (expected.kind === "refused" && expected.classes === null) {
        unclassifiedRefusalExpectations += 1;
      }
      const commandMetric = commandMetrics.get(command.id)!;
      attempted += 1;
      commandMetric.attempted += 1;
      depth(nextDepth).attempted += 1;

      const childSystem = callHarness(
        `System fork for ${node.seedId}:${nextTrace.join(",")}`,
        () => node.system.fork(),
      );
      if (
        childSystem === null || typeof childSystem !== "object" ||
        typeof childSystem.fork !== "function"
      ) {
        harnessFailure(`System fork for ${command.id} did not return a forkable system`);
      }
      if (childSystem === node.system) {
        harnessFailure(`System fork for ${command.id} returned the parent system`);
      }
      const parentFingerprint = stableJson(systemFingerprint(
        node.system,
        node.observation,
        `Parent fingerprint before ${command.id}`,
      ));

      let observation: Observation | undefined;
      let refusal: Readonly<{ code: string; message: string }> | null = null;
      try {
        syncResult(command.apply(childSystem, nextTrace), `Command ${command.id} apply`);
        observation = syncResult(
          scenario.observe(childSystem),
          `Scenario observation after ${command.id}`,
        );
      } catch (error) {
        const code = codedError(error);
        if (code === null) {
          harnessFailure(
            `Non-coded failure while applying ${command.id} at ` +
              `${node.seedId}:${nextTrace.join(",")}`,
            error,
          );
        }
        refusal = Object.freeze({
          code,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const parentAfter = callHarness(
        `Parent observation after child command ${command.id}`,
        () => scenario.observe(node.system),
      );
      const parentFingerprintAfter = stableJson(systemFingerprint(
        node.system,
        parentAfter,
        `Parent fingerprint after ${command.id}`,
      ));
      if (parentFingerprintAfter !== parentFingerprint) {
        harnessFailure(`System fork for ${command.id} allowed child mutation to change its parent`);
      }

      if (refusal !== null) {
        refused += 1;
        commandMetric.refused += 1;
        depth(nextDepth).refused += 1;
        const retained = refusalMetrics.get(refusal.code) ?? { count: 0, shortest: null };
        retained.count += 1;
        const witness = Object.freeze({
          seedId: node.seedId,
          depth: nextDepth,
          trace: nextTrace,
          message: refusal.message,
        });
        if (
          retained.shortest === null || witness.depth < retained.shortest.depth ||
          (witness.depth === retained.shortest.depth &&
            stableWitness(witness.seedId, witness.trace) <
              stableWitness(retained.shortest.seedId, retained.shortest.trace))
        ) {
          retained.shortest = witness;
        }
        refusalMetrics.set(refusal.code, retained);

        if (
          expected.kind === "accepted" ||
          !matchesRefusalClass(refusal.code, expected.classes)
        ) {
          expectationMismatches += 1;
          const expectedDescription = expected.kind === "accepted"
            ? "accepted"
            : refusalExpectationDescription(expected.classes);
          recordFinding(Object.freeze({
            signature: `transition/${command.id}/${expectedDescription}/refused:${refusal.code}`,
            kind: "transition-expectation-mismatch",
            command: command.id,
            expected: expectedDescription,
            actual: `refused:${refusal.code}`,
            message: refusal.message,
          }), context, "transition");
        }
        continue;
      }

      if (observation === undefined) {
        harnessFailure(`Command ${command.id} produced neither an observation nor a refusal`);
      }
      accepted += 1;
      commandMetric.accepted += 1;
      depth(nextDepth).accepted += 1;
      recordObservation(observation, context);
      recordModel(expected.kind === "accepted" ? expected.next : node.model);
      maximumDepthReached = Math.max(maximumDepthReached, nextDepth);

      if (expected.kind === "refused") {
        expectationMismatches += 1;
        oracleBlockedAccepted += 1;
        const expectedDescription = refusalExpectationDescription(expected.classes);
        recordFinding(Object.freeze({
          signature: `transition/${command.id}/${expectedDescription}/accepted`,
          kind: "transition-expectation-mismatch",
          command: command.id,
          expected: expectedDescription,
          actual: "accepted",
        }), context, "transition");
        continue;
      }

      const child = Object.freeze({
        seedId: node.seedId,
        system: childSystem,
        model: expected.next,
        observation,
        trace: nextTrace,
        depth: nextDepth,
      });
      if (queue.length >= maxNodes) {
        harnessFailure(`Scenario ${scenario.id} exceeded bounds.maxNodes`);
      }
      depth(nextDepth).nodes += 1;
      runInvariants(child);
      queue.push(child);
    }
  }

  const levels = [...depthMetrics.values()]
    .sort((left, right) => left.depth - right.depth)
    .map((value) => Object.freeze({ ...value }));
  const frontierNodes = levels.reduce((sum, value) => sum + value.frontier, 0);
  const findingValues = [...findings.values()].sort((left, right) =>
    left.depth - right.depth || left.signature.localeCompare(right.signature) ||
    stableWitness(left.seedId, left.trace).localeCompare(
      stableWitness(right.seedId, right.trace),
    ));
  const semanticValues = [...semanticObservations.values()]
    .sort((left, right) => left.signature.localeCompare(right.signature));
  const refusals = [...refusalMetrics]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, value]) => Object.freeze({
      code,
      count: value.count,
      shortest: value.shortest,
    }));
  const coverageCommands = [...commandMetrics]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, value]) => Object.freeze({ id, ...value }));
  const acceptedCommandIds = new Set(coverageCommands
    .filter(({ accepted: acceptedCount }) => acceptedCount > 0)
    .map(({ id }) => id));
  const missingCoverage = Object.freeze({
    phases: Object.freeze(requiredCoverage.phases.filter((phase) => !modelPhases.has(phase))),
    acceptedCommands: Object.freeze(requiredCoverage.acceptedCommands.filter(
      (id) => !acceptedCommandIds.has(id),
    )),
    eventKinds: Object.freeze(requiredCoverage.eventKinds.filter(
      (eventKind) => !eventKinds.has(eventKind),
    )),
    seedEventKinds: Object.freeze(requiredCoverage.seedEventKinds.filter(
      (eventKind) => !seedEventKinds.has(eventKind),
    )),
    generatedEventKinds: Object.freeze(requiredCoverage.generatedEventKinds.filter(
      (eventKind) => !generatedEventKinds.has(eventKind),
    )),
    recoveryCoordinates: Object.freeze(requiredCoverage.recoveryCoordinates.filter(
      (coordinate) => !recoveryCoordinates.has(coordinate),
    )),
  });
  const coverageSatisfied = Object.values(missingCoverage)
    .every((values) => values.length === 0);

  const report: ExplorationReport = Object.freeze({
    contractVersion: BOUNDED_EXPLORATION_CONTRACT_VERSION,
    reportFormat: BOUNDED_EXPLORATION_REPORT_FORMAT,
    scenarioId: scenario.id,
    clauses: Object.freeze([...scenario.clauses]),
    bounds: Object.freeze({ ...scenario.bounds }),
    dedupeMode: "none",
    seeds: Object.freeze(seeds.map(({ id }) => id)),
    commands: Object.freeze(commands.map(({ id }) => id)),
    transitions: Object.freeze({
      attempted,
      accepted,
      refused,
      expectationMismatches,
      oracleBlockedAccepted,
      unclassifiedRefusalExpectations,
    }),
    refusalCodes: Object.freeze(refusals),
    normalizedSemanticObservations: Object.freeze({
      count: semanticValues.length,
      values: Object.freeze(semanticValues),
    }),
    depths: Object.freeze(levels),
    maximumDepthReached,
    frontier: Object.freeze({
      depth: maxDepth,
      nodes: frontierNodes,
      truncated: frontierNodes > 0,
    }),
    coverage: Object.freeze({
      commands: Object.freeze(coverageCommands),
      eventKinds: Object.freeze({
        all: eventCoverageProvided ? Object.freeze([...eventKinds].sort()) : null,
        seed: seedEventCoverageProvided ? Object.freeze([...seedEventKinds].sort()) : null,
        generated: generatedEventCoverageProvided
          ? Object.freeze([...generatedEventKinds].sort())
          : null,
      }),
      recoveryCoordinates: recoveryCoverageProvided
        ? Object.freeze([...recoveryCoordinates].sort())
        : null,
      modelPhases: Object.freeze([...modelPhases].sort()),
      requirements: Object.freeze({
        declared: requiredCoverage,
        missing: missingCoverage,
        satisfied: coverageSatisfied,
      }),
    }),
    findings: Object.freeze(findingValues),
  });
  return validateExplorationReport(report);
}
