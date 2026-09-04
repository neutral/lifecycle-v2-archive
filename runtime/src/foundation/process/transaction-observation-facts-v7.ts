import type { ControlJsonObject, ControlJsonValue } from "../control/types.js";
import { FoundationError } from "../error.js";
import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import type { DeliveryOperation } from "./delivery-state.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const GIT_OBJECT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const GIT_REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u;
type TransactionEffectOutcome = "applied" | "not-applied" | "indeterminate";
export type FoundationTransactionDecisionKindV7 =
  | "admit"
  | "readmit"
  | "accept"
  | "no-ship";

export const FOUNDATION_ADMISSION_TRANSACTION_OBSERVATION_FACTS_V1 =
  "lifecycle.admission-effect-observation-facts.v2" as const;
export const FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1 =
  "lifecycle.terminal-repository-effect-observation.v1" as const;
export const FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1 =
  "lifecycle.terminal-acceptance-effect-observation.v1" as const;
export const FOUNDATION_TERMINAL_DETACHED_OBSERVATION_FACTS_V1 =
  "lifecycle.terminal-detached-canonical-effect-observation.v1" as const;
export const FOUNDATION_TERMINAL_FAILURE_OBSERVATION_FACTS_V1 =
  "lifecycle.terminal-effect-failure.v1" as const;

type AdmissionDisposition = Readonly<{
  outcome: "not-applied";
  reason: "repository-basis-mismatch" | "candidate-continuity-mismatch";
  observedFactsDigest: Sha256;
}>;

export type FoundationAdmissionTransactionObservationFactsV1 = ControlJsonObject & Readonly<{
  schema: typeof FOUNDATION_ADMISSION_TRANSACTION_OBSERVATION_FACTS_V1;
  outcome: TransactionEffectOutcome;
  disposition: AdmissionDisposition | null;
  repositoryBasisDigest: Sha256 | null;
}>;

type TerminalRepositoryCoordinate = Readonly<{
  ref: string;
  commit: string;
  tree: string;
  objectFormat: "sha1" | "sha256";
}>;

export type FoundationTerminalRepositoryObservationFactsV1 = ControlJsonObject &
  TerminalRepositoryCoordinate & Readonly<{
    schema: typeof FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1;
  }>;

export type FoundationTerminalAcceptanceObservationFactsV1 = ControlJsonObject &
  TerminalRepositoryCoordinate & Readonly<{
    schema: typeof FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1;
    canonicalResultDigest: Sha256;
  }>;

export type FoundationTerminalDetachedObservationFactsV1 = ControlJsonObject & Readonly<{
  schema: typeof FOUNDATION_TERMINAL_DETACHED_OBSERVATION_FACTS_V1;
  attached: TerminalRepositoryCoordinate;
  canonicalRef: string;
  canonicalCommit: string;
  canonicalTree: string;
}>;

export type FoundationTerminalFailureObservationFactsV1 = ControlJsonObject & Readonly<{
  schema: typeof FOUNDATION_TERMINAL_FAILURE_OBSERVATION_FACTS_V1;
  stage:
    | "repository-observation"
    | "accepted-checkout"
    | "acceptance-effect"
    | "no-ship-non-integration";
  code: string;
}>;

export type FoundationTransactionObservationFactsV7 =
  | FoundationAdmissionTransactionObservationFactsV1
  | FoundationTerminalAcceptanceObservationFactsV1
  | FoundationTerminalRepositoryObservationFactsV1
  | FoundationTerminalDetachedObservationFactsV1
  | FoundationTerminalFailureObservationFactsV1;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.transaction-observation-facts-v7.${code}`, message);
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("shape", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function exactKeys(value: ControlJsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const selected = [...expected].sort();
  if (actual.length !== selected.length || actual.some((key, index) => key !== selected[index])) {
    fail("shape", `${label} must contain exactly ${selected.join(", ")}`);
  }
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("shape", `${label} must be one string`);
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = string(value, label);
  if (!SHA256.test(selected)) fail("digest", `${label} must be one lowercase SHA-256 digest`);
  return selected as Sha256;
}

function nullableDigest(value: ControlJsonValue | undefined, label: string): Sha256 | null {
  return value === null ? null : digest(value, label);
}

function identifier(value: ControlJsonValue | undefined, label: string): string {
  const selected = string(value, label);
  if (!IDENTIFIER.test(selected) || Buffer.byteLength(selected, "utf8") > 512) {
    fail("identity", `${label} must be one bounded opaque identity`);
  }
  return selected;
}

function gitObject(value: ControlJsonValue | undefined, label: string): string {
  const selected = string(value, label);
  if (!GIT_OBJECT.test(selected)) fail("git-object", `${label} must be one full Git object identity`);
  return selected;
}

function gitRef(value: ControlJsonValue | undefined, label: string): string {
  const selected = string(value, label);
  if (!GIT_REF.test(selected) || Buffer.byteLength(selected, "ascii") > 512) {
    fail("git-ref", `${label} must be one bounded canonical branch ref`);
  }
  return selected;
}

function repositoryCoordinate(
  value: ControlJsonObject,
  label: string,
): "sha1" | "sha256" {
  exactKeys(value, ["ref", "commit", "tree", "objectFormat"], label);
  gitRef(value.ref, `${label} ref`);
  if (value.objectFormat !== "sha1" && value.objectFormat !== "sha256") {
    fail("shape", `${label} object format is unsupported`);
  }
  const commit = gitObject(value.commit, `${label} commit`);
  const tree = gitObject(value.tree, `${label} tree`);
  const expectedLength = value.objectFormat === "sha1" ? 40 : 64;
  if (commit.length !== expectedLength || tree.length !== expectedLength) {
    fail(
      "git-object-format",
      `${label} Git object lengths must match its declared object format`,
    );
  }
  return value.objectFormat;
}

function admissionFacts(value: ControlJsonObject): void {
  exactKeys(value, [
    "schema",
    "outcome",
    "disposition",
    "repositoryBasisDigest",
  ], "Admission transaction observation facts");
  if (!( ["applied", "not-applied", "indeterminate"] as const)
    .includes(value.outcome as TransactionEffectOutcome)) {
    fail("shape", "Admission transaction observation outcome is unsupported");
  }
  nullableDigest(value.repositoryBasisDigest, "Admission repository basis digest");
  if (value.disposition !== null) {
    const disposition = object(value.disposition, "Admission disposition");
    exactKeys(disposition, ["outcome", "reason", "observedFactsDigest"], "Admission disposition");
    if (
      disposition.outcome !== "not-applied" ||
      (disposition.reason !== "repository-basis-mismatch" &&
        disposition.reason !== "candidate-continuity-mismatch")
    ) {
      fail("shape", "Admission disposition is unsupported");
    }
    digest(disposition.observedFactsDigest, "Admission disposition observed facts digest");
  }
  if ((value.outcome === "not-applied") !== (value.disposition !== null)) {
    fail("outcome", "Admission disposition must exist exactly for a not-applied observation");
  }
  if (value.outcome !== "indeterminate" && value.repositoryBasisDigest === null) {
    fail("outcome", "Determinate Admission observation requires its repository basis digest");
  }
  if (value.disposition !== null) {
    const disposition = value.disposition as AdmissionDisposition;
    if (
      disposition.reason === "repository-basis-mismatch" &&
      disposition.observedFactsDigest !== value.repositoryBasisDigest
    ) {
      fail(
        "outcome",
        "Repository-basis mismatch disposition must bind the observed repository basis",
      );
    }
  }
}

function terminalFailureFacts(value: ControlJsonObject): void {
  exactKeys(value, ["schema", "stage", "code"], "Terminal failure observation facts");
  if (!( [
    "repository-observation",
    "accepted-checkout",
    "acceptance-effect",
    "no-ship-non-integration",
  ] as const).includes(value.stage as FoundationTerminalFailureObservationFactsV1["stage"])) {
    fail("shape", "Terminal failure observation stage is unsupported");
  }
  identifier(value.code, "Terminal failure observation code");
}

export function parseFoundationTransactionObservationFactsV7(
  value: ControlJsonValue | undefined,
): FoundationTransactionObservationFactsV7 {
  const facts = object(value, "Transaction observation facts");
  const schema = string(facts.schema, "Transaction observation facts schema");
  if (schema === FOUNDATION_ADMISSION_TRANSACTION_OBSERVATION_FACTS_V1) {
    admissionFacts(facts);
  } else if (schema === FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1) {
    exactKeys(facts, ["schema", "ref", "commit", "tree", "objectFormat"],
      "Terminal repository observation facts");
    repositoryCoordinate(Object.freeze({
      ref: facts.ref!, commit: facts.commit!, tree: facts.tree!, objectFormat: facts.objectFormat!,
    }), "Terminal repository coordinate");
  } else if (schema === FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1) {
    exactKeys(facts, [
      "schema", "ref", "commit", "tree", "objectFormat", "canonicalResultDigest",
    ], "Terminal acceptance observation facts");
    repositoryCoordinate(Object.freeze({
      ref: facts.ref!, commit: facts.commit!, tree: facts.tree!, objectFormat: facts.objectFormat!,
    }), "Terminal acceptance repository coordinate");
    digest(facts.canonicalResultDigest, "Terminal acceptance canonical-result digest");
  } else if (schema === FOUNDATION_TERMINAL_DETACHED_OBSERVATION_FACTS_V1) {
    exactKeys(facts, [
      "schema", "attached", "canonicalRef", "canonicalCommit", "canonicalTree",
    ], "Terminal detached observation facts");
    const objectFormat = repositoryCoordinate(
      object(facts.attached, "Terminal attached coordinate"),
      "Terminal attached coordinate");
    gitRef(facts.canonicalRef, "Terminal canonical ref");
    const canonicalCommit = gitObject(facts.canonicalCommit, "Terminal canonical commit");
    const canonicalTree = gitObject(facts.canonicalTree, "Terminal canonical tree");
    const expectedLength = objectFormat === "sha1" ? 40 : 64;
    if (canonicalCommit.length !== expectedLength || canonicalTree.length !== expectedLength) {
      fail(
        "git-object-format",
        "Terminal canonical Git object lengths must match the attached object format",
      );
    }
  } else if (schema === FOUNDATION_TERMINAL_FAILURE_OBSERVATION_FACTS_V1) {
    terminalFailureFacts(facts);
  } else {
    fail("schema", "Transaction observation facts use an unsupported schema");
  }
  return facts as FoundationTransactionObservationFactsV7;
}

export function assertFoundationTransactionObservationFactsV7(input: Readonly<{
  operation: DeliveryOperation;
  decisionKind: FoundationTransactionDecisionKindV7;
  outcome: TransactionEffectOutcome;
  facts: ControlJsonValue | undefined;
  factsDigest: ControlJsonValue | undefined;
}>): FoundationTransactionObservationFactsV7 {
  const facts = parseFoundationTransactionObservationFactsV7(input.facts);
  const retainedDigest = digest(input.factsDigest, "Transaction observation facts digest");
  if (digestCanonical(facts) !== retainedDigest) {
    fail("digest-mismatch", "Transaction observation facts differ from their retained digest");
  }
  if (facts.schema === FOUNDATION_ADMISSION_TRANSACTION_OBSERVATION_FACTS_V1) {
    if (
      input.operation !== "delivery.admit" ||
      !(input.decisionKind === "admit" || input.decisionKind === "readmit") ||
      facts.outcome !== input.outcome
    ) {
      fail("operation", "Admission observation facts do not match their activity and outcome");
    }
    if (
      input.decisionKind === "admit" &&
      facts.disposition?.reason === "candidate-continuity-mismatch"
    ) {
      fail("decision", "Initial Admission cannot report a Candidate continuity mismatch");
    }
    return facts;
  }
  if (!(input.operation === "delivery.accept" || input.operation === "delivery.no-ship")) {
    fail("operation", "Terminal observation facts require one terminal activity");
  }
  if (
    (input.operation === "delivery.accept" && input.decisionKind !== "accept") ||
    (input.operation === "delivery.no-ship" && input.decisionKind !== "no-ship")
  ) {
    fail("operation", "Terminal observation facts differ from their Founder Decision");
  }
  if (facts.schema === FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1 && (
    input.operation !== "delivery.accept" || input.outcome !== "applied"
  )) {
    fail("outcome", "Acceptance result facts require one applied acceptance observation");
  }
  if (
    input.operation === "delivery.accept" && input.outcome === "applied" &&
    facts.schema !== FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1
  ) {
    fail("outcome", "Applied acceptance requires its exact canonical-result digest");
  }
  if (facts.schema === FOUNDATION_TERMINAL_DETACHED_OBSERVATION_FACTS_V1 &&
    input.operation !== "delivery.accept") {
    fail("operation", "Detached canonical observation facts require acceptance");
  }
  if (
    facts.schema === FOUNDATION_TERMINAL_DETACHED_OBSERVATION_FACTS_V1 &&
    input.outcome === "applied"
  ) {
    fail("outcome", "Detached canonical observation facts cannot establish applied acceptance");
  }
  if (facts.schema === FOUNDATION_TERMINAL_FAILURE_OBSERVATION_FACTS_V1) {
    const noShip = facts.stage === "no-ship-non-integration";
    if (noShip !== (input.operation === "delivery.no-ship")) {
      fail("operation", "Terminal failure observation stage differs from its operation");
    }
    if (input.outcome !== "indeterminate") {
      fail("outcome", "Terminal failure observation facts require an indeterminate outcome");
    }
  }
  return facts;
}

export function foundationTransactionObservationFactsDigestV7(
  facts: FoundationTransactionObservationFactsV7,
): Sha256 {
  parseFoundationTransactionObservationFactsV7(facts);
  return digestCanonical(facts);
}
