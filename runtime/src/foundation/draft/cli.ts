import { basename, dirname, isAbsolute } from "node:path";
import { FOUNDATION_SEMANTIC_MARKDOWN_MAXIMUM_BYTES } from "@neutral/lifecycle-protocol";
import { FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_MAXIMUM_BYTES } from "../control/agent-work-product-semantics.js";
import { FoundationError } from "../error.js";
import { canonicalJson, canonicalJsonLine } from "../validation/canonical.js";
import { parseStrictJson } from "../validation/strict-json.js";
import { inspectFoundationDraftForm } from "./forms.js";
import { inspectFoundationKnowledgeDraft } from "./knowledge.js";
import { decodeFoundationLocalDraftUtf8, readFoundationLocalDraftFile } from "./local-reader.js";
import { inspectFoundationSemanticDraftV1 } from "./semantic.js";

export const FOUNDATION_DRAFT_HELP = [
  "Lifecycle draft — read-only local authoring assistance",
  "",
  "USAGE",
  "  lifecycle draft forms [knowledge|reconnaissance|builder|reviewer] [--format human|json]",
  "  lifecycle draft knowledge WORKSPACE PATH... [--format human|json]",
  "  lifecycle draft semantic WORKSPACE PATH --basis ABSOLUTE_FILE [--format human|json]",
  "",
  "Forms expose installed formats. Knowledge inspects the explicit local file set, including",
  "unstaged/untracked files; supply every local revision in each selected chain. Its parsing",
  "policy comes from the workspace's public .lifecycle/repository.json, without opening a target.",
  "Semantic checks the selected draft against the exact supplied immutable authoring basis.",
  "PATH is relative to WORKSPACE. Inputs must be bounded non-executable regular files without",
  "links. No command edits files, scans for credentials, opens a Store, or invokes a backend.",
  "",
  "Results describe only the observed bytes and checked scope. They are not Candidate validity,",
  "currentness, eligibility, Evidence, or acceptance. Runtime validates final collected output",
  "independently. Correct a draft and repeat this command; no new Attempt is needed for this read.",
  "Human output is the default. Exit 1 means correction is needed; exit 2 means invalid syntax.",
  "",
].join("\n");

export type FoundationDraftCliDispatch = Readonly<{
  kind: "foundation-draft-cli-dispatch";
  format: "human" | "json";
  value: Readonly<Record<string, unknown>>;
  exitCode: number;
}>;

function usage(message: string): never { throw new FoundationError("cli.usage", message); }

export async function dispatchFoundationDraftCli(args: readonly string[]): Promise<FoundationDraftCliDispatch> {
  const values: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) { values.push(arg); continue; }
    if (arg !== "--format" && arg !== "--basis") usage(`Unsupported draft option ${arg}; use lifecycle help draft`);
    const value = args[++index];
    if (value === undefined || value.startsWith("--") || options.has(arg)) usage(`${arg} requires one value exactly once`);
    options.set(arg, value);
  }
  const format = options.get("--format") ?? "human";
  if (format !== "json" && format !== "human") usage("draft --format must be human or json");
  const [command, workspace, ...paths] = values;
  let value: Readonly<Record<string, unknown>>;
  if (command === "forms") {
    if (paths.length !== 0 || options.has("--basis")) usage("draft forms accepts at most one form and --format");
    value = inspectFoundationDraftForm(workspace);
  } else if (command === "knowledge") {
    if (workspace === undefined || paths.length === 0 || options.has("--basis")) usage("draft knowledge requires WORKSPACE and explicit PATH... selections");
    value = await inspectFoundationKnowledgeDraft({ workspace, paths });
  } else if (command === "semantic") {
    const basisPath = options.get("--basis");
    if (workspace === undefined || paths.length !== 1 || basisPath === undefined || !isAbsolute(basisPath)) {
      usage("draft semantic requires WORKSPACE PATH and --basis ABSOLUTE_FILE selecting the immutable authoring basis");
    }
    const semantic = await readFoundationLocalDraftFile({ root: workspace, path: paths[0]!, maximumBytes: FOUNDATION_SEMANTIC_MARKDOWN_MAXIMUM_BYTES });
    const basis = await readFoundationLocalDraftFile({ root: dirname(basisPath), path: basename(basisPath), maximumBytes: FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_MAXIMUM_BYTES });
    value = inspectFoundationSemanticDraftV1({
      semanticMarkdown: decodeFoundationLocalDraftUtf8(semantic),
      basis: parseStrictJson(decodeFoundationLocalDraftUtf8(basis), { source: "Selected draft semantic basis", maximumBytes: FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_MAXIMUM_BYTES }),
    });
  } else usage("Choose lifecycle draft forms, knowledge, or semantic; use lifecycle help draft for exact syntax");
  const status = value.status;
  const exitCode = status === "needs-correction" || status === "invalid-result" || status === "runtime-failure" ? 1 : 0;
  return Object.freeze({ kind: "foundation-draft-cli-dispatch", format, value, exitCode });
}

export function isFoundationDraftCliDispatch(value: unknown): value is FoundationDraftCliDispatch {
  return value !== null && typeof value === "object" && "kind" in value && value.kind === "foundation-draft-cli-dispatch";
}

export function renderFoundationDraftCli(result: FoundationDraftCliDispatch): string {
  if (result.format === "json") return canonicalJsonLine(result.value);
  const value = result.value;
  if (value.kind === "semantic-form" && typeof value.markdown === "string") return `${value.markdown}\n${value.next}\n`;
  const lines = ["LOCAL DRAFT — advisory observation", `Profile: ${String(value.profile)}`, `Scope: ${String(value.kind ?? "semantic-draft")}`, ""];
  if (typeof value.status === "string") lines.push(`Result: ${value.status}`);
  for (const key of ["sourceSelectionDigest", "sourceDigest", "inputDigest", "basisDigest", "parsingPolicyDigest", "contractSourceDigest"]) {
    if (typeof value[key] === "string") lines.push(`${key}: ${value[key]}`);
  }
  if (Array.isArray(value.records)) {
    for (const record of value.records as Record<string, unknown>[]) {
      lines.push("", `${record.path}  ${record.id}@${record.revision}  ${record.status}`, `  sourceDigest   ${record.sourceDigest}`, `  semanticDigest ${record.semanticDigest}`);
      if (record.supersedes !== null) lines.push(`  supersedes ${canonicalJson(record.supersedes)}`);
    }
  }
  for (const key of ["forms", "checked", "excluded", "diagnostics", "diagnostic"]) {
    const entries = value[key];
    if (entries === undefined || entries === null || (Array.isArray(entries) && entries.length === 0)) continue;
    lines.push("", `${key}:`);
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      lines.push(`  ${typeof entry === "string" ? entry : canonicalJson(entry)}`);
    }
  }
  if (value.kind === "knowledge-form") lines.push("", JSON.stringify(value.body, null, 2), "", JSON.stringify(value.frontMatterSchema, null, 2));
  if (typeof value.next === "string") lines.push("", value.next);
  lines.push("", "Local inspection grants no authority. Runtime revalidates the final collected result.", "");
  return lines.join("\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu,
    (value) => `\\u${value.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
