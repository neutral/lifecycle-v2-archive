import {
  type FoundationRuntimeOperationKind,
} from "@neutral/lifecycle-protocol";
import {
  hasTuiUnsafeText,
  TUI_PRESENTATION_SOURCE_MAX_CODE_UNITS,
  tuiSafeJson,
  tuiSafeLine,
} from "../view/sanitize.js";

export type HandoffInputKind =
  | "none"
  | "initialization-file"
  | "semantic-markdown-file";

export type LifecycleCliHandoff = Readonly<{
  mode: "print-only";
  effectOwner: "canonical-lifecycle-cli";
  operation: FoundationRuntimeOperationKind;
  argv: readonly string[];
  shellCommand: string | null;
  inputKind: HandoffInputKind;
  deliveryId: string | null;
  unresolvedArguments: readonly string[];
  reviewed: Readonly<{
    targetId: string | null;
    deliveryId: string | null;
    repositoryContractDigest: string | null;
    headCommit: string | null;
  }>;
  warning: string;
}>;

const INPUT_PLACEHOLDERS: Readonly<Record<Exclude<HandoffInputKind, "none">, string>> = Object.freeze({
  "initialization-file": "<initialization-input.json>",
  "semantic-markdown-file": "<semantic-input.md>",
});

function shellSafe(value: string): boolean {
  return !hasTuiUnsafeText(value);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function createLifecycleCliHandoff(options: Readonly<{
  operation: FoundationRuntimeOperationKind;
  executable: string;
  command: string;
  target: string;
  deliveryId: string | null;
  inputKind: HandoffInputKind;
  authoritySecretRequired: boolean;
  reviewed: LifecycleCliHandoff["reviewed"];
}>): LifecycleCliHandoff {
  const deliveryBound = ![
    "repository.initialize",
    "repository.validate",
    "delivery.prepare",
  ].includes(options.operation);
  if (!deliveryBound) {
    if (options.deliveryId !== null || options.reviewed.deliveryId !== null) {
      throw new TypeError(`${options.operation} cannot carry a Delivery identity`);
    }
  } else if (options.deliveryId === null || options.reviewed.deliveryId !== options.deliveryId) {
    throw new TypeError("A Delivery handoff requires the exact reviewed Delivery identity");
  }
  const argv = [
    options.executable,
    options.command,
    options.target,
  ];
  if (options.deliveryId !== null) argv.push(options.deliveryId);
  if (options.inputKind !== "none") {
    argv.push("--input", INPUT_PLACEHOLDERS[options.inputKind]);
  }
  if (options.authoritySecretRequired) {
    argv.push("--authority-secret-file", "<authority-secret-file>");
  }
  argv.push("--format", "human");
  const unresolvedArguments = argv.filter((value) => value.startsWith("<") && value.endsWith(">"));
  return Object.freeze({
    mode: "print-only",
    effectOwner: "canonical-lifecycle-cli",
    operation: options.operation,
    argv: Object.freeze(argv),
    shellCommand: process.platform !== "win32" && argv.every(shellSafe)
      ? argv.map(shellQuote).join(" ")
      : null,
    inputKind: options.inputKind,
    deliveryId: options.deliveryId,
    unresolvedArguments: Object.freeze(unresolvedArguments),
    reviewed: Object.freeze({ ...options.reviewed }),
    warning: options.reviewed.targetId === null
      ? "The canonical CLI performs its own fresh-target checks before initialization."
      : "The reviewed Journal reduction is transparency, not a second request surface. The canonical CLI re-observes the target and derives all target, Process, package, identity, digest, and time mechanics under the operation's exact concurrency scope.",
  });
}

export function renderLifecycleCliHandoff(handoff: LifecycleCliHandoff): string {
  const safe = (value: string | null): string => tuiSafeLine(
    value ?? "unavailable",
    TUI_PRESENTATION_SOURCE_MAX_CODE_UNITS,
  );
  const lines = [
    "Lifecycle canonical CLI handoff",
    "",
    "Controller outcome: print-only handoff; the canonical lifecycle CLI remains the package compiler, authority, and effect owner.",
    "The Founder supplies semantic input only where this exact operation requires it; Process and package mechanics are runtime-derived.",
    `Required operation input: ${handoff.inputKind}`,
    `Unresolved arguments: ${handoff.unresolvedArguments.length === 0 ? "none" : handoff.unresolvedArguments.map(safe).join(", ")}`,
    "",
    handoff.warning,
    "",
    "Reviewed target epoch:",
    `  target: ${safe(handoff.reviewed.targetId)}`,
    `  Delivery: ${safe(handoff.reviewed.deliveryId)}`,
    `  contract: ${safe(handoff.reviewed.repositoryContractDigest)}`,
    `  HEAD: ${safe(handoff.reviewed.headCommit)}`,
    "",
    "Argv template (exact fixed arguments; angle-bracket values remain unresolved):",
    `  ${tuiSafeJson(handoff.argv)}`,
  ];
  if (handoff.shellCommand !== null) {
    lines.push("", "POSIX shell form:", `  ${handoff.shellCommand}`);
  } else {
    lines.push("", "A POSIX shell form is unavailable on this platform or because an argument contains terminal-unsafe text.");
  }
  return `${lines.join("\n")}\n`;
}
