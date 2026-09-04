import { TextDecoder } from "node:util";
import {
  FoundationDeliveryDiffSchema,
  type FoundationDeliveryDiff,
  type FoundationDeliveryGeneration,
  type FoundationDeliveryState,
} from "@neutral/lifecycle-protocol";
import type { ControlRecordStore } from "../control/store.js";
import type { ControlJsonObject, ControlJsonValue, ControlRecordRevision } from "../control/types.js";
import {
  canonicalRepository,
  git,
  gitBytes,
  resolveGitObjectFormat,
} from "../repository/git.js";
import { sha256Bytes, type Sha256 } from "../validation/canonical.js";
import {
  candidateRevisionCarrierVerificationParent,
  openCandidateRevisionCarrier,
} from "./carrier-store.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
} from "./carrier-types.js";
import { withVerifiedCandidateRevisionCarrierRepository } from "./git-object-closure.js";

const UTF8 = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

function objectValue(value: ControlJsonValue | undefined): ControlJsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ControlJsonObject
    : null;
}

function stringValue(value: ControlJsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integerValue(value: ControlJsonValue | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function exactRevision(
  store: ControlRecordStore,
  selected: FoundationDeliveryState["subjects"][keyof FoundationDeliveryState["subjects"]],
  kind: string,
): ControlRecordRevision | null {
  if (selected === null) return null;
  const revision = store.getRevision(selected.id, selected.revision);
  return revision !== null && revision.recordKind === kind && revision.digest === selected.digest
    ? revision
    : null;
}

function unavailable(input: Readonly<{
  generation: FoundationDeliveryGeneration;
  subject: "candidate" | "decision";
  candidate: FoundationDeliveryState["subjects"]["candidate"];
  seal: FoundationDeliveryState["subjects"]["seal"];
  reason: string;
}>): FoundationDeliveryDiff {
  return FoundationDeliveryDiffSchema.parse({
    schema: "lifecycle.delivery-diff.v1",
    generation: input.generation,
    subject: input.subject,
    currentness: "unavailable",
    candidate: input.candidate,
    seal: input.seal,
    baseCommit: null,
    tree: null,
    exactDiffDigest: null,
    contentDigest: null,
    byteLength: 0,
    truncated: false,
    content: null,
    unavailableReason: input.reason,
  });
}

function safeTerminalText(bytes: Uint8Array, maximumBytes: number): Readonly<{
  content: string;
  truncated: boolean;
}> {
  const decoded = UTF8.decode(bytes);
  const parts: string[] = [];
  let byteLength = 0;
  let truncated = false;
  for (const point of decoded) {
    const code = point.codePointAt(0)!;
    const safe = point === "\n" || point === "\t" ||
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd)
      ? point
      : "?";
    const size = Buffer.byteLength(safe, "utf8");
    if (byteLength + size > maximumBytes) {
      truncated = true;
      break;
    }
    parts.push(safe);
    byteLength += size;
  }
  return Object.freeze({ content: parts.join(""), truncated });
}

type CandidateCarrierManifestReference = Readonly<{
  digest: Sha256;
  byteLength: number;
  mediaType: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE;
  purpose: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE;
}>;

function carrierManifestReference(
  candidate: ControlRecordRevision,
): CandidateCarrierManifestReference | null {
  const selected = objectValue(candidate.payload.carrierManifest);
  if (selected === null) return null;
  const keys = Object.keys(selected).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== "byteLength" ||
    keys[1] !== "digest" ||
    keys[2] !== "mediaType" ||
    keys[3] !== "purpose"
  ) return null;
  const digest = stringValue(selected.digest);
  const byteLength = integerValue(selected.byteLength);
  if (
    digest === null || !/^sha256:[a-f0-9]{64}$/u.test(digest) ||
    byteLength === null || byteLength < 1 ||
    selected.mediaType !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE ||
    selected.purpose !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE
  ) return null;
  return Object.freeze({
    digest: digest as Sha256,
    byteLength,
    mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
    purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
  });
}

async function candidateCarrierDiff(input: Readonly<{
  machineHome: string;
  repository: string;
  store: ControlRecordStore;
  candidate: ControlRecordRevision;
  baseCommit: string;
  tree: string;
  maximumBytes: number;
}>): Promise<Awaited<ReturnType<typeof gitBytes>>> {
  const reference = carrierManifestReference(input.candidate);
  if (reference === null) throw new TypeError("Candidate Revision has no exact Carrier manifest reference");
  const retained = await input.store.readRetainedFile(reference.digest);
  if (
    retained === null ||
    retained.descriptor.digest !== reference.digest ||
    retained.descriptor.byteLength !== reference.byteLength ||
    retained.descriptor.mediaType !== reference.mediaType ||
    retained.descriptor.purpose !== reference.purpose ||
    retained.bytes.byteLength !== reference.byteLength ||
    sha256Bytes(retained.bytes) !== reference.digest
  ) {
    throw new TypeError("Candidate Revision Carrier manifest is unavailable or substituted");
  }
  const source = await canonicalRepository(input.repository);
  const objectFormat = await resolveGitObjectFormat(source);
  const opened = await openCandidateRevisionCarrier({
    machineHome: input.machineHome,
    manifestBytes: retained.bytes,
  });
  if (
    opened.manifest.rootTree !== input.tree ||
    opened.manifest.objectFormat !== objectFormat
  ) {
    throw new TypeError("Candidate Revision Carrier differs from its retained Candidate subject");
  }
  const verificationParent = await candidateRevisionCarrierVerificationParent(input.machineHome);
  return await withVerifiedCandidateRevisionCarrierRepository({
    artifactPath: opened.artifactPath,
    manifest: opened.manifest,
    verificationParent,
    limits: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    operation: async (repository, closure) => {
      if (
        closure.rootTree !== input.tree ||
        closure.objectFormat !== objectFormat
      ) {
        throw new TypeError("Verified Candidate Revision Carrier selected another Git closure");
      }
      await git(repository, [
        "-c",
        "protocol.file.allow=always",
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--no-auto-maintenance",
        source,
        input.baseCommit,
      ], {
        timeoutMs: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1.commandTimeoutMs,
        maxStdoutBytes: 1024 * 1024,
      });
      const resolvedCommit = (await git(repository, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${input.baseCommit}^{commit}`,
      ])).stdout.trim();
      if (resolvedCommit !== input.baseCommit) {
        throw new TypeError("Imported Candidate base differs from its exact retained commit");
      }
      return await gitBytes(repository, [
        "diff",
        "--binary",
        "--full-index",
        "--no-color",
        "--no-ext-diff",
        "--no-renames",
        input.baseCommit,
        input.tree,
        "--",
      ], {
        maxStdoutBytes: input.maximumBytes + 1,
        timeoutMs: 120_000,
      });
    },
  });
}

export async function compileDeliveryDiff(input: Readonly<{
  machineHome: string;
  repository: string;
  store: ControlRecordStore;
  state: FoundationDeliveryState;
  generation: FoundationDeliveryGeneration;
  subject: "candidate" | "decision";
  maximumBytes: number;
}>): Promise<FoundationDeliveryDiff> {
  const candidate = exactRevision(input.store, input.state.subjects.candidate, "candidate-revision");
  if (candidate === null) {
    return unavailable({
      ...input,
      candidate: input.state.subjects.candidate,
      seal: input.subject === "decision" ? input.state.subjects.seal : null,
      reason: "No exact current Candidate revision is available.",
    });
  }
  const baseCommit = stringValue(candidate.payload.candidateBaseCommit);
  const state = objectValue(candidate.payload.state);
  const tree = stringValue(state?.tree);
  const exactDiffDigest = stringValue(state?.diffDigest) as Sha256 | null;
  if (baseCommit === null || tree === null || exactDiffDigest === null) {
    return unavailable({
      ...input,
      candidate: input.state.subjects.candidate,
      seal: input.subject === "decision" ? input.state.subjects.seal : null,
      reason: "The current Candidate has no available immutable diff subject.",
    });
  }

  let sealReference = null;
  if (input.subject === "decision") {
    const seal = exactRevision(input.store, input.state.subjects.seal, "candidate-seal");
    const sealedCandidate = seal?.relationships.find(({ relation }) => relation === "seals")?.target ?? null;
    const selected = input.state.subjects.candidate;
    if (
      seal === null || selected === null || sealedCandidate === null ||
      sealedCandidate.kind !== "candidate-revision" || sealedCandidate.id !== selected.id ||
      sealedCandidate.revision !== selected.revision || sealedCandidate.digest !== selected.digest
    ) {
      return unavailable({
        ...input,
        candidate: input.state.subjects.candidate,
        seal: input.state.subjects.seal,
        reason: "Decision diff requires one exact Candidate Seal bound to the current Candidate.",
      });
    }
    sealReference = input.state.subjects.seal;
  }

  let result: Awaited<ReturnType<typeof gitBytes>>;
  try {
    result = await candidateCarrierDiff({
      machineHome: input.machineHome,
      repository: input.repository,
      store: input.store,
      candidate,
      baseCommit,
      tree,
      maximumBytes: input.maximumBytes,
    });
  } catch {
    return unavailable({
      ...input,
      candidate: input.state.subjects.candidate,
      seal: sealReference,
      reason: "The exact immutable Candidate diff is unavailable from its retained Candidate Revision Carrier.",
    });
  }
  const sourceTruncated = result.stdoutTruncated || result.stdout.byteLength > input.maximumBytes;
  if (!sourceTruncated && sha256Bytes(result.stdout) !== exactDiffDigest) {
    return unavailable({
      ...input,
      candidate: input.state.subjects.candidate,
      seal: sealReference,
      reason: "The immutable Candidate diff does not reproduce its retained exact digest.",
    });
  }
  const selected = result.stdout.subarray(0, input.maximumBytes);
  const safe = safeTerminalText(selected, input.maximumBytes);
  const content = safe.content;
  const contentBytes = Buffer.from(content, "utf8");
  return FoundationDeliveryDiffSchema.parse({
    schema: "lifecycle.delivery-diff.v1",
    generation: input.generation,
    subject: input.subject,
    currentness: input.subject === "candidate" &&
        input.generation.activeOperation?.operation === "delivery.continue"
      ? "potentially-advancing"
      : "exact",
    candidate: input.state.subjects.candidate,
    seal: sealReference,
    baseCommit,
    tree,
    exactDiffDigest,
    contentDigest: sha256Bytes(contentBytes),
    byteLength: contentBytes.byteLength,
    truncated: sourceTruncated || safe.truncated,
    content,
    unavailableReason: null,
  });
}
