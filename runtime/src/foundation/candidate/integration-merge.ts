import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { FoundationError } from "../error.js";
import { git, gitBytes } from "../repository/git.js";
import type { FoundationGitObjectFormat } from "../repository/types.js";
import { canonicalJson, digestCanonical, sha256Bytes, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { normalizedPath } from "../validation/value.js";
import { publishCandidateRevisionCarrierFromGitTree } from "./carrier-binding.js";
import { importCandidateRevisionCarrierIntoRepository } from "./carrier-import.js";
import { parseCandidateRevisionCarrierManifest } from "./carrier-manifest.js";
import { candidateRevisionCarrierVerificationParent } from "./carrier-store.js";
import { FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1 } from "./carrier-types.js";

const MAXIMUM_MERGE_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAXIMUM_CONFLICT_PATHS = 4_096;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const MERGE_FLAGS = Object.freeze([
  "-c", "merge.renames=true",
  "-c", "merge.directoryRenames=conflict",
  "-c", "merge.renameLimit=10000",
  "-c", "merge.renormalize=false",
  "merge-tree", "--write-tree", "--name-only", "-z", "--messages",
  "-Xfind-renames=50%", "-Xno-renormalize", "-Xdiff-algorithm=histogram",
]);

export type FoundationIntegrationMergeRuleV1 = Readonly<{
  id: "lifecycle.integration.three-way.v2";
  implementationId: string;
  implementationDigest: Sha256;
}>;

export type FoundationIntegrationConflictV1 = Readonly<{
  path: string;
  kind: "content" | "add-add" | "modify-delete" | "rename" | "mode" | "type" | "unsupported";
}>;

export type FoundationIntegrationMergeOutputV1 =
  | Readonly<{ outcome: "constructed"; rootTree: string; conflicts: readonly [] }>
  | Readonly<{ outcome: "conflicted"; conflicts: readonly FoundationIntegrationConflictV1[] }>;

function fail(message: string): never {
  throw new FoundationError("lifecycle.integration.merge-invalid", message);
}

/** Git 2.45 added tree operands with an explicit tree base; 2.43 added -X. */
export function assertFoundationIntegrationGitVersionV1(gitVersion: string): void {
  if (!/^git version [^\r\n\0]{1,200}$/u.test(gitVersion)) fail("Git did not report a bounded implementation identity");
  const match = /^git version (0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?: [^\r\n\0]+)?$/u.exec(gitVersion);
  if (match === null || BigInt(match[1]!) < 2n || (BigInt(match[1]!) === 2n && BigInt(match[2]!) < 45n)) {
    fail("Integration requires Git 2.45.0 or newer with explicit tree merge bases and strategy options");
  }
}

/** Bind the fixed algorithm and installed Git executable before retaining intent. */
export async function foundationIntegrationMergeRuleV1(): Promise<FoundationIntegrationMergeRuleV1> {
  const [version, executable] = await Promise.all([
    git("/", ["--version"], { maxStdoutBytes: 1_024 }),
    readFile("/usr/bin/git"),
  ]);
  const gitVersion = version.stdout.trim();
  assertFoundationIntegrationGitVersionV1(gitVersion);
  return Object.freeze({
    id: "lifecycle.integration.three-way.v2",
    implementationId: "lifecycle.integration.git-merge-tree.v1",
    implementationDigest: digestCanonical({
      domain: "lifecycle.integration.three-way.implementation.v1",
      executable: sha256Bytes(executable),
      gitVersion,
      flags: MERGE_FLAGS,
      base: "explicit-source-candidate-application-tree",
      sides: ["selected-canonical-parent", "source-candidate"],
      environment: "foundation-git-no-ambient-configuration",
    }),
  });
}

function path(value: string): string {
  try {
    normalizedPath(value, "Integration conflict path");
    if (Buffer.byteLength(value) > 4096) fail("Integration conflict path exceeds its byte bound");
    return value;
  } catch {
    fail("Integration output contains an invalid repository-relative path");
  }
}

function conflictKind(type: string): FoundationIntegrationConflictV1["kind"] {
  // Only Git's stable short type token is interpreted. Human message text is
  // deliberately discarded; it is neither an oracle nor an instruction.
  if (type === "CONFLICT (contents)" || type === "CONFLICT (binary)") return "content";
  if (type === "CONFLICT (add/add)") return "add-add";
  if (type === "CONFLICT (modify/delete)") return "modify-delete";
  if (type.startsWith("CONFLICT (") && /rename/iu.test(type)) return "rename";
  if (type === "CONFLICT (distinct modes)") return "mode";
  if (type === "CONFLICT (file/directory)" || type === "CONFLICT (distinct types)") return "type";
  return "unsupported";
}

/** Bounded NUL framing; exit status, never a path list or conflict markers, owns success. */
export function parseFoundationIntegrationMergeOutputV1(input: Readonly<{
  bytes: Uint8Array;
  exitCode: number;
  objectFormat: FoundationGitObjectFormat;
}>): FoundationIntegrationMergeOutputV1 {
  if (input.exitCode !== 0 && input.exitCode !== 1) fail("Integration merge did not complete a supported observation");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAXIMUM_MERGE_OUTPUT_BYTES || input.bytes.at(-1) !== 0) {
    fail("Integration output is empty, exceeds its bound, or has incomplete NUL framing");
  }
  let fields: string[];
  try { fields = UTF8.decode(input.bytes).split("\0"); }
  catch { fail("Integration output is not exact UTF-8"); }
  fields.pop();
  const rootTree = fields.shift()!;
  if (!new RegExp(`^[a-f0-9]{${input.objectFormat === "sha1" ? 40 : 64}}$`, "u").test(rootTree)) {
    fail("Integration output has no exact result tree identity");
  }
  let index = 0;
  const staged = new Set<string>();
  while (index < fields.length && fields[index] !== "") {
    staged.add(path(fields[index++]!));
    if (staged.size > MAXIMUM_CONFLICT_PATHS) fail("Integration conflict inventory exceeds its bound");
  }
  if (fields[index++] !== "") fail("Integration output lacks its message-section boundary");
  const conflicts = new Map<string, FoundationIntegrationConflictV1>();
  const explainedPaths = new Set<string>();
  const insert = (conflictPath: string, kind: FoundationIntegrationConflictV1["kind"]) => {
    conflicts.set(canonicalJson([conflictPath, kind]), Object.freeze({ path: conflictPath, kind }));
    explainedPaths.add(conflictPath);
    if (conflicts.size > MAXIMUM_CONFLICT_PATHS) fail("Integration conflict facts exceed their bound");
  };
  while (index < fields.length) {
    const countText = fields[index++]!;
    if (!/^[1-9][0-9]{0,6}$/u.test(countText)) fail("Integration message has an invalid path count");
    const count = Number(countText);
    if (count > MAXIMUM_CONFLICT_PATHS || index + count + 2 > fields.length) fail("Integration message has incomplete bounded framing");
    const paths = fields.slice(index, index + count).map(path);
    index += count;
    const type = fields[index++]!;
    index += 1; // Opaque human message: never expose or parse it.
    if (type === "Auto-merging") continue;
    if (!type.startsWith("CONFLICT (") || !type.endsWith(")")) fail("Integration output contains an unsupported message type");
    for (const conflictPath of paths) insert(conflictPath, conflictKind(type));
  }
  if (input.exitCode === 1 && conflicts.size === 0) fail("Conflicted integration has no complete conflict messages");
  for (const conflictPath of staged) {
    if (!explainedPaths.has(conflictPath)) insert(conflictPath, "unsupported");
  }
  if (input.exitCode === 0) {
    if (conflicts.size !== 0) fail("Clean integration status contradicts conflict facts");
    return Object.freeze({ outcome: "constructed", rootTree, conflicts: Object.freeze([] as const) });
  }
  if (conflicts.size === 0) fail("Conflicted integration has no complete conflict facts");
  // A conflicted result's marker-bearing tree can never cross the Candidate seam.
  return Object.freeze({
    outcome: "conflicted",
    conflicts: Object.freeze([...conflicts.values()].sort((left, right) =>
      compareCodePoints(left.path, right.path) || compareCodePoints(left.kind, right.kind))),
  });
}

/**
 * Construct an exact three-way tree in independent disposable Git storage.
 * This publishes only reconstructible Carrier bytes. The integration owner
 * separately observes P→I, checks governing context, and selects a Candidate.
 */
export async function constructFoundationIntegrationTreeV1(input: Readonly<{
  machineHome: string;
  baseManifestBytes: Uint8Array;
  candidateManifestBytes: Uint8Array;
  parentManifestBytes: Uint8Array;
  mergeRule: FoundationIntegrationMergeRuleV1;
}>): Promise<
  | Readonly<{ outcome: "constructed"; rootTree: string; manifestBytes: Uint8Array; conflicts: readonly [] }>
  | Readonly<{ outcome: "conflicted"; conflicts: readonly FoundationIntegrationConflictV1[] }>
> {
  if (canonicalJson(input.mergeRule) !== canonicalJson(await foundationIntegrationMergeRuleV1())) {
    fail("Installed integration implementation differs from the retained merge selection");
  }
  const manifests = [input.baseManifestBytes, input.candidateManifestBytes, input.parentManifestBytes]
    .map((bytes) => parseCandidateRevisionCarrierManifest(bytes, FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1));
  const [base, candidate, parent] = manifests;
  if (manifests.some((manifest) => manifest.objectFormat !== base!.objectFormat)) fail("Integration inputs have different Git object formats");
  const verificationParent = await candidateRevisionCarrierVerificationParent(input.machineHome);
  const root = await mkdtemp(join(verificationParent, "integration-"));
  try {
    const repository = join(root, "repository");
    await mkdir(repository, { mode: 0o700 });
    await git(repository, ["init", "--template=", `--object-format=${base!.objectFormat}`, "-b", "integration"]);
    const bytes = [input.baseManifestBytes, input.candidateManifestBytes, input.parentManifestBytes];
    for (let index = 0; index < manifests.length; index += 1) {
      await importCandidateRevisionCarrierIntoRepository({
        machineHome: input.machineHome,
        manifestBytes: bytes[index]!,
        repository,
        expectedRootTree: manifests[index]!.rootTree,
      });
    }
    const command = await gitBytes(repository, [
      ...MERGE_FLAGS,
      `--merge-base=${base!.rootTree}`, parent!.rootTree, candidate!.rootTree,
    ], {
      allowFailure: true,
      timeoutMs: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1.commandTimeoutMs,
      maxStdoutBytes: MAXIMUM_MERGE_OUTPUT_BYTES,
      maxStderrBytes: 16_384,
    });
    const result = parseFoundationIntegrationMergeOutputV1({
      bytes: command.stdout,
      exitCode: command.exitCode,
      objectFormat: base!.objectFormat,
    });
    if (result.outcome === "conflicted") return result;
    const published = await publishCandidateRevisionCarrierFromGitTree({
      machineHome: input.machineHome,
      repository,
      rootTree: result.rootTree,
    });
    return Object.freeze({ ...result, manifestBytes: published.manifestBytes });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
