import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FoundationError } from "../error.js";
import type { ControlRecordStore } from "../control/store.js";
import type { ControlRecordRevision } from "../control/types.js";
import { compileControlRecordRevision } from "../control/model.js";
import { resolveCandidateIntegrationProvenanceV1, type FoundationCandidateIntegrationProvenanceV1 } from "../control/integration-assessment.js";
import { openCandidateRevisionCarrier } from "../candidate/carrier-store.js";
import { canonicalJson, digestCanonical, selfDigest, sha256Bytes } from "../validation/canonical.js";
import { git } from "./git.js";
import { assertIndependentGitRepository } from "./independent-git.js";
import { openFoundationDeliveryGitBasisV1, openFoundationDeliveryGitSnapshotV1 } from "./delivery-git-basis.js";
import { foundationDeliveryGitBranchV1, parseFoundationDeliveryGitContextV1, type FoundationDeliveryGitContextManifestV1 } from "./delivery-git-context-manifest.js";

const DURABLE = ["-c", "core.fsync=committed", "-c", "core.fsyncMethod=fsync"] as const;
function invalid(message: string): never { throw new FoundationError("lifecycle.repository.git-context-invalid", message); }
async function directory(path: string, create: boolean): Promise<string> {
  if (create) { try { await mkdir(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } }
  const state = await lstat(path);
  if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 ||
      state.uid !== (process.geteuid?.() ?? process.getuid?.() ?? state.uid) || await realpath(path) !== path) invalid("Delivery Git context requires exact private custody");
  return path;
}
function exact(store: ControlRecordStore, revision: ControlRecordRevision): ControlRecordRevision {
  const retained = store.getRevision(revision.recordId, revision.revision);
  if (retained === null || retained.processId !== store.identity.processId ||
      canonicalJson(retained) !== canonicalJson(revision) ||
      canonicalJson(compileControlRecordRevision(store.identity.processId, retained)) !== canonicalJson(retained)) invalid("Delivery Git context requires exact retained Control revisions");
  return retained;
}
function related(store: ControlRecordStore, revision: ControlRecordRevision, relation: string, kind: string): ControlRecordRevision {
  const links = revision.relationships.filter((edge) => edge.relation === relation);
  if (links.length !== 1 || links[0]!.target.kind !== kind) invalid("Delivery Git context lacks exact Candidate ancestry");
  const link = links[0]!.target;
  const retained = store.getRevision(link.id, link.revision);
  if (retained === null || retained.recordKind !== kind || retained.digest !== link.digest) invalid("Delivery Git context ancestry cannot be reopened");
  return exact(store, retained);
}

/**
 * Runtime-owned tool history, reconstructed from Control-selected immutable
 * Candidate lineage. Provider Git refs, commits, configuration and working state
 * are never imported. Delivery serialization is held by the operation owner.
 */
export async function openFoundationDeliveryGitContextV1(input: Readonly<{
  machineHome: string; repository: string; store: ControlRecordStore; candidate: ControlRecordRevision;
}>): Promise<Readonly<{ repository: string; manifest: FoundationDeliveryGitContextManifestV1; manifestBytes: Uint8Array; artifactBytes: Uint8Array }>> {
  try {
    const identity = Object.freeze({ targetId: input.store.identity.targetId, storeId: input.store.identity.storeId, processId: input.store.identity.processId });
    const branch = foundationDeliveryGitBranchV1(identity);
    const lineage: ControlRecordRevision[] = [];
    const visited = new Set<string>();
    let selected = exact(input.store, input.candidate);
    for (;;) {
      if (selected.recordKind !== "candidate-revision" || selected.payload.schema !== "lifecycle.candidate-revision-payload.v3" ||
          lineage.length >= 1_000_000 || visited.has(selected.digest)) invalid("Delivery Git context requires bounded current Candidate lineage");
      lineage.push(selected);
      visited.add(selected.digest);
      if (selected.payload.observation === "initialization") break;
      selected = related(input.store, selected, "revises", "candidate-revision");
    }
    lineage.reverse();
    // Resolve each integration segment once through its Control owner. A long
    // sequence of ordinary Attempts must not repeatedly walk the same history.
    const indexByDigest = new Map(lineage.map((candidate, index) => [candidate.digest, index]));
    const provenanceByDigest = new Map<string, FoundationCandidateIntegrationProvenanceV1 | null>();
    let end = lineage.length - 1;
    while (end >= 0) {
      const provenance = resolveCandidateIntegrationProvenanceV1({ store: input.store, candidate: lineage[end]! });
      const source = provenance === null ? -1 : indexByDigest.get(provenance.sourceCandidate.digest);
      if (source === undefined || source >= end) invalid("Delivery work history lacks the integration segment's exact source");
      for (let index = end; index > source; index -= 1) provenanceByDigest.set(lineage[index]!.digest, provenance);
      end = source;
    }
    const firstBoundary = related(input.store, lineage[0]!, "governed-by", "work-boundary");
    const firstBasis = await openFoundationDeliveryGitBasisV1({ ...input, boundary: firstBoundary });
    const home = await directory(resolve(input.machineHome), false);
    const parent = await directory(join(await directory(join(home, "delivery-git-contexts"), true), "v1"), true);
    const repository = join(parent, digestCanonical(identity).slice(7));
    let created = false;
    try { await mkdir(repository, { mode: 0o700 }); created = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (created) {
      await git(repository, [...DURABLE, "init", "--template=", `--object-format=${firstBasis.loaded.snapshot.objectFormat}`, "-b", branch.slice("refs/heads/".length)]);
    }
    await directory(repository, false);
    await assertIndependentGitRepository(repository);
    const config = (await git(repository, ["config", "--local", "--no-includes", "--name-only", "--list"])).stdout.trim().split("\n");
    const allowed = new Set(["core.repositoryformatversion", "core.filemode", "core.bare", "core.logallrefupdates", "core.ignorecase", "core.precomposeunicode", "extensions.objectformat"]);
    if (config.some((key) => !allowed.has(key.toLowerCase())) ||
        (await git(repository, ["rev-parse", "--show-object-format"])).stdout.trim() !== firstBasis.loaded.snapshot.objectFormat) invalid("Delivery Git context contains settings outside its fixed independent construction");
    const imported = new Set<string>();
    const importBase = async (source: string, commit: string): Promise<void> => {
      if (imported.has(commit)) return;
      await git(repository, [...DURABLE, "-c", "protocol.file.allow=always", "fetch", "--no-tags", "--no-write-fetch-head", "--no-auto-maintenance", source, commit]);
      imported.add(commit);
    };
    await importBase(firstBasis.repository, firstBasis.loaded.snapshot.commit);
    let tip = firstBasis.loaded.snapshot.commit;
    let rootTree = firstBasis.loaded.snapshot.tree;
    const staging = await mkdtemp(join(parent, ".pack-"));
    try {
      await chmod(staging, 0o700);
      for (const candidate of lineage) {
        const provenance = provenanceByDigest.get(candidate.digest)!;
        const base = provenance?.canonicalParent.commit ?? firstBasis.loaded.snapshot.commit;
        if (candidate.payload.candidateBaseCommit !== base) invalid("Delivery Git work history cannot change the selected application base");
        const parents = [tip];
        if (candidate.payload.observation === "integration-successor") {
          if (provenance === null) invalid("Integrated work history lacks its exact parent");
          const basis = await openFoundationDeliveryGitSnapshotV1({ ...input, identity, snapshot: provenance.canonicalParent });
          await importBase(basis.repository, base);
          if (!parents.includes(base)) parents.push(base);
        }
        const carrier = candidate.payload.carrierManifest as Readonly<Record<string, unknown>>;
        const retained = await input.store.readRetainedFile(carrier.digest as `sha256:${string}`);
        if (retained === null || retained.descriptor.byteLength !== carrier.byteLength || retained.descriptor.mediaType !== carrier.mediaType || retained.descriptor.purpose !== carrier.purpose || sha256Bytes(retained.bytes) !== carrier.digest) invalid("Delivery work history lacks the exact retained Candidate Carrier");
        const opened = await openCandidateRevisionCarrier({ machineHome: input.machineHome, manifestBytes: retained.bytes });
        rootTree = opened.manifest.rootTree;
        if ((candidate.payload.state as Readonly<Record<string, unknown>>).tree !== rootTree || opened.manifest.objectFormat !== firstBasis.loaded.snapshot.objectFormat) invalid("Delivery work history and Candidate Carrier disagree");
        // index-pack accepts exact pack bytes through a private copied file;
        // no provider or canonical object directory is shared with this repo.
        const packName = join(repository, ".git", "objects", "pack", `carrier-${opened.manifest.carrierArtifact.digest.slice(7)}.pack`);
        let handle;
        try { handle = await open(packName, "wx", 0o600); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        const bytes = await readFile(opened.artifactPath);
        if (bytes.byteLength !== opened.manifest.carrierArtifact.byteLength || sha256Bytes(bytes) !== opened.manifest.carrierArtifact.digest) invalid("Delivery work history Carrier artifact changed during import");
        if (handle !== undefined) { try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } }
        else if (sha256Bytes(await readFile(packName)) !== opened.manifest.carrierArtifact.digest) invalid("Retained work history pack differs from its exact Carrier");
        await git(repository, [...DURABLE, "-c", "pack.writeReverseIndex=false", "index-pack", "--strict", packName]);
        const seconds = Math.floor(Date.parse(candidate.createdAt) / 1000);
        if (!Number.isSafeInteger(seconds)) invalid("Candidate history requires one exact creation time");
        const commitBytes = `tree ${rootTree}\n${parents.map((parent) => `parent ${parent}\n`).join("")}author Lifecycle Runtime <runtime@lifecycle.invalid> ${seconds} +0000\ncommitter Lifecycle Runtime <runtime@lifecycle.invalid> ${seconds} +0000\n\nLifecycle Candidate ${candidate.recordId}@${candidate.revision}\n${candidate.digest}\n`;
        tip = (await git(repository, [...DURABLE, "hash-object", "-t", "commit", "-w", "--stdin"], { input: commitBytes })).stdout.trim();
        const pin = `refs/lifecycle/candidates/${candidate.digest.slice(7)}`;
        await assertIndependentGitRepository(repository, [pin, branch]);
        const existing = await git(repository, ["rev-parse", "--verify", pin], { allowFailure: true });
        if (existing.exitCode === 0 && existing.stdout.trim() !== tip) invalid("Retained work history pin differs from its exact Candidate-derived commit");
        await git(repository, [...DURABLE, "update-ref", pin, tip]);
      }
      await git(repository, [...DURABLE, "update-ref", branch, tip]);
      await git(repository, ["symbolic-ref", "HEAD", branch]);
      await git(repository, [...DURABLE, "reset", "--hard", tip]);
      await git(repository, ["fsck", "--strict", "--full", "--no-reflogs", "--no-dangling", tip]);
      const ids = [...new Set((await git(repository, ["rev-list", "--objects", "--no-object-names", tip], { maxStdoutBytes: 65_000_001 })).stdout.trim().split("\n"))].sort();
      if (ids.length > 1_000_000) invalid("Delivery Git work history exceeds its object bound");
      const rows = (await git(repository, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], { input: `${ids.join("\n")}\n`, maxStdoutBytes: 112_000_001 })).stdout.trim().split("\n");
      const objectInventory = rows.map((row, index) => {
        const match = /^([a-f0-9]+) (commit|tree|blob) (\d+)$/u.exec(row);
        if (match === null || match[1] !== ids[index]) invalid("Delivery Git work history inventory is incomplete");
        return Object.freeze({ objectId: match[1]!, objectType: match[2]! as "commit" | "tree" | "blob", byteLength: Number(match[3]) });
      });
      const aggregateObjectBytes = objectInventory.reduce((sum, entry) => sum + entry.byteLength, 0);
      if (rows.length !== ids.length || objectInventory.some((entry) => !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0) || !Number.isSafeInteger(aggregateObjectBytes)) invalid("Delivery Git work history exceeds its aggregate byte bound");
      const packBase = join(staging, "history");
      const packed = (await git(repository, ["-c", "pack.writeReverseIndex=false", "pack-objects", "--no-revs", "--no-thin", "--no-reuse-delta", "--no-reuse-object", "--window=0", "--depth=0", "--threads=1", "--compression=0", "--index-version=2", "--no-write-bitmap-index", packBase], { input: `${ids.join("\n")}\n`, timeoutMs: 120_000 })).stdout.trim();
      if (!new RegExp(firstBasis.loaded.snapshot.objectFormat === "sha1" ? "^[a-f0-9]{40}$" : "^[a-f0-9]{64}$", "u").test(packed)) invalid("Delivery Git pack construction returned another object identity");
      const artifactBytes = Uint8Array.from(await readFile(`${packBase}-${packed}.pack`));
      for (const path of [join(repository, ".git"), repository, parent]) {
        const handle = await open(path, "r");
        try { await handle.sync(); } finally { await handle.close(); }
      }
      const subject = { schema: "lifecycle.delivery-git-context.private.v1" as const, identity,
        candidate: { recordId: input.candidate.recordId, revision: input.candidate.revision, digest: input.candidate.digest },
        branch, tipCommit: tip, rootTree, objectFormat: firstBasis.loaded.snapshot.objectFormat,
        objectInventory, objectCount: objectInventory.length, aggregateObjectBytes,
        objectInventoryDigest: digestCanonical(objectInventory), artifact: { format: "git-pack-v2" as const, digest: sha256Bytes(artifactBytes), byteLength: artifactBytes.byteLength } };
      const manifestBytes = Uint8Array.from(Buffer.from(`${canonicalJson({ ...subject, digest: selfDigest(subject) })}\n`, "utf8"));
      const manifest = parseFoundationDeliveryGitContextV1(manifestBytes);
      return Object.freeze({ repository, manifest, manifestBytes, artifactBytes });
    } finally { await rm(staging, { recursive: true, force: true }); }
  } catch (error) {
    if (error instanceof FoundationError && error.code === "lifecycle.repository.git-context-invalid") throw error;
    throw new FoundationError("lifecycle.repository.git-context-incomplete", "Exact Delivery Git work context could not be reproduced", { retryable: true });
  }
}
