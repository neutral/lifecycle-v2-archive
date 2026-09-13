import { spawnSync } from "node:child_process";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { FoundationError } from "../error.js";
import { foundationDescriptorLockProvider } from "../support/descriptor-lock.js";
import { canonicalJson, canonicalJsonLine, digestCanonical, selfDigest, sha256Bytes, type Sha256 } from "../validation/canonical.js";

const PREFIX = "lifecycle.execution.provider-credential-custody-v1.";
const AUTH_LIMIT = 4 * 1024 * 1024;
const METADATA_LIMIT = 16 * 1024;
const RECEIPT_LIMIT = 1024;
const ROOT = ".lifecycle-provider-credential-custody-v1";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export type FoundationProviderCredentialSubjectV1 = Readonly<{
  specificationDigest: Sha256;
  engineIdentityDigest: Sha256;
  allocationName: string;
}>;

export type FoundationProviderCredentialSettlementV1 =
  | Readonly<{ kind: "updated"; bytes: Uint8Array }>
  | Readonly<{ kind: "unused" }>
  | Readonly<{ kind: "lost" }>;

/** Installation-private receipt; never an Input, Output, Control or provider artifact. */
export type FoundationProviderCredentialSettlementReceiptV1 = Readonly<{
  schema: "lifecycle.provider-credential-settlement.private.v1";
  subject: FoundationProviderCredentialSubjectV1;
  subjectDigest: Sha256;
  generation: number;
  disposition: "updated" | "unused" | "lost";
  originalDigest: Sha256;
  resultDigest: Sha256 | null;
  settledAt: string;
  digest: Sha256;
}>;

type Claim = Readonly<{
  subject: FoundationProviderCredentialSubjectV1;
  subjectDigest: Sha256;
  generation: number;
  originalDigest: Sha256;
  originalByteLength: number;
  claimedAt: string;
}>;
type State = Readonly<{
  schema: "lifecycle.provider-credential-custody.private.v1";
  generation: number;
  credentialDigest: Sha256;
  blockedCredentialDigest: Sha256 | null;
  active: Claim | null;
  digest: Sha256;
}>;
type Pending = Readonly<{
  schema: "lifecycle.provider-credential-pending.private.v1";
  receipt: FoundationProviderCredentialSettlementReceiptV1;
  digest: Sha256;
}>;
export type FoundationProviderCredentialDurableBoundaryV1 =
  | "claim-retained" | "settlement-prepared" | "credential-replaced" | "settlement-retained";

function fail(code: string, message: string, retryable = false): never {
  throw new FoundationError(`${PREFIX}${code}`, message, { retryable });
}

function sanitized(error: unknown): never {
  if (error instanceof FoundationError && error.code.startsWith(PREFIX)) throw error;
  fail("unavailable", "Private provider credential custody is temporarily unavailable", true);
}

function subject(value: FoundationProviderCredentialSubjectV1): FoundationProviderCredentialSubjectV1 {
  if (value === null || typeof value !== "object" ||
      Object.keys(value).sort().join(",") !== "allocationName,engineIdentityDigest,specificationDigest" ||
      !SHA256.test(value.specificationDigest) || !SHA256.test(value.engineIdentityDigest) ||
      !/^lifecycle-execution-[a-f0-9]{64}$/u.test(value.allocationName)) {
    fail("subject", "Provider credential custody requires one exact execution allocation subject");
  }
  return Object.freeze({ ...value });
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    fail("integrity", "Private provider credential metadata has an invalid shape");
  }
  return value as Record<string, unknown>;
}

function digest(value: unknown): Sha256 {
  if (typeof value !== "string" || !SHA256.test(value)) fail("integrity", "Private provider credential metadata has an invalid digest");
  return value as Sha256;
}

function generation(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fail("integrity", "Private provider credential generation is invalid");
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) fail("integrity", "Private provider credential timestamp is invalid");
  return value;
}

function checkSelfDigest(value: Record<string, unknown>): void {
  if (digest(value.digest) !== selfDigest(value, "digest")) {
    fail("integrity", "Private provider credential metadata changed its retained digest");
  }
}

function parseReceipt(value: unknown): FoundationProviderCredentialSettlementReceiptV1 {
  const v = object(value, ["schema", "subject", "subjectDigest", "generation", "disposition", "originalDigest", "resultDigest", "settledAt", "digest"]);
  const selected = subject(v.subject as FoundationProviderCredentialSubjectV1);
  if (v.schema !== "lifecycle.provider-credential-settlement.private.v1" ||
      digest(v.subjectDigest) !== digestCanonical(selected) ||
      !["updated", "unused", "lost"].includes(String(v.disposition))) {
    fail("integrity", "Private provider credential settlement is invalid");
  }
  generation(v.generation); timestamp(v.settledAt); digest(v.originalDigest);
  if (v.disposition === "lost") {
    if (v.resultDigest !== null) fail("integrity", "Lost provider credentials cannot name a settled result");
  } else digest(v.resultDigest);
  if (v.disposition === "unused" && v.resultDigest !== v.originalDigest) {
    fail("integrity", "Unused provider credentials cannot change their retained generation");
  }
  checkSelfDigest(v);
  return Object.freeze({ ...v, subject: selected }) as FoundationProviderCredentialSettlementReceiptV1;
}

function parseState(value: unknown): State {
  const v = object(value, ["schema", "generation", "credentialDigest", "blockedCredentialDigest", "active", "digest"]);
  if (v.schema !== "lifecycle.provider-credential-custody.private.v1") fail("integrity", "Private provider credential state is unsupported");
  generation(v.generation); digest(v.credentialDigest);
  if (v.blockedCredentialDigest !== null && digest(v.blockedCredentialDigest) !== v.credentialDigest) {
    fail("integrity", "Unusable provider credential state has a substituted generation");
  }
  if (v.active !== null) {
    const active = object(v.active, ["subject", "subjectDigest", "generation", "originalDigest", "originalByteLength", "claimedAt"]);
    const selected = subject(active.subject as FoundationProviderCredentialSubjectV1);
    if (digest(active.subjectDigest) !== digestCanonical(selected) || generation(active.generation) !== v.generation ||
        digest(active.originalDigest) !== v.credentialDigest || v.blockedCredentialDigest !== null ||
        !Number.isSafeInteger(active.originalByteLength) || (active.originalByteLength as number) < 2 ||
        (active.originalByteLength as number) > AUTH_LIMIT) {
      fail("integrity", "Private provider credential claim changed its exact generation");
    }
    timestamp(active.claimedAt);
  }
  checkSelfDigest(v);
  return v as unknown as State;
}

function parsePending(value: unknown): Pending {
  const v = object(value, ["schema", "receipt", "digest"]);
  if (v.schema !== "lifecycle.provider-credential-pending.private.v1") fail("integrity", "Private provider credential transaction is unsupported");
  parseReceipt(v.receipt); checkSelfDigest(v);
  return v as unknown as Pending;
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function assertFile(value: Stats, minimum: number, maximum: number): void {
  const uid = process.geteuid?.() ?? process.getuid?.();
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1 ||
      (uid !== undefined && value.uid !== uid) || (value.mode & 0o7777) !== 0o600 ||
      value.size < minimum || value.size > maximum) {
    fail("private-path", "Provider credentials require bounded private owned regular files");
  }
}

async function directory(path: string): Promise<void> {
  const metadata = await lstat(path);
  const uid = process.geteuid?.() ?? process.getuid?.();
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o7777) !== 0o700 ||
      (uid !== undefined && metadata.uid !== uid) || await realpath(path) !== path) {
    fail("private-path", "Provider credentials require exact private owned directories");
  }
}

async function makeDirectory(path: string): Promise<void> {
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await directory(path);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function privateBytes(path: string, maximum: number, minimum = 2): Promise<Buffer | null> {
  let metadata: Stats;
  try { metadata = await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  assertFile(metadata, minimum, maximum);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer | null = null;
  try {
    const opened = await handle.stat(); assertFile(opened, minimum, maximum);
    if (!sameFile(metadata, opened)) fail("private-path", "Private provider credential file changed while opening");
    // Never let growth after the metadata observation turn a bounded credential
    // read into an unbounded allocation. One extra byte detects an overrun.
    bytes = Buffer.alloc(opened.size);
    let length = 0;
    while (length < bytes.byteLength) {
      const result = await handle.read(bytes, length, bytes.byteLength - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    const overflow = Buffer.alloc(1);
    let extra = 0;
    try { extra = (await handle.read(overflow, 0, 1, opened.size)).bytesRead; }
    finally { overflow.fill(0); }
    const after = await handle.stat(), entry = await lstat(path);
    assertFile(after, minimum, maximum); assertFile(entry, minimum, maximum);
    if (length !== opened.size || extra !== 0 || !sameFile(opened, after) || !sameFile(opened, entry)) {
      fail("private-path", "Private provider credential file changed while reading");
    }
    const retained = bytes; bytes = null; return retained;
  } finally { bytes?.fill(0); await handle.close(); }
}

async function removePrivate(path: string, maximum: number): Promise<void> {
  let metadata: Stats;
  try { metadata = await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  assertFile(metadata, 0, maximum); await unlink(path);
}

/** Fixed owner-private scratch names are recoverable; an unrelated path is never removed. */
async function writePrivate(path: string, parent: string, bytes: Uint8Array, maximum: number): Promise<void> {
  if (bytes.byteLength > maximum) fail("integrity", "Private provider credential write exceeds its bound");
  const scratch = `${path}.next`;
  await removePrivate(scratch, maximum);
  const handle = await open(scratch, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  const existing = await privateBytes(path, maximum, 0); existing?.fill(0);
  await rename(scratch, path); await syncDirectory(parent);
}

async function json(path: string): Promise<unknown | null> {
  const bytes = await privateBytes(path, METADATA_LIMIT);
  if (bytes === null) return null;
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { fail("integrity", "Private provider credential metadata cannot be parsed"); }
  finally { bytes.fill(0); }
}

async function writeJson(path: string, parent: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(canonicalJsonLine(value));
  try { await writePrivate(path, parent, bytes, METADATA_LIMIT); }
  finally { bytes.fill(0); }
}

/**
 * One dedicated provider session has one durable execution claim. Descriptor
 * locks protect only private filesystem transitions; PID loss does not release
 * the retained claim. Credential writeback has a durable intent and receipt
 * before that claim is released, so an old retry never overwrites a new claim.
 */
export async function openFoundationProviderCredentialCustodyV1(input: Readonly<{
  codexHome: string;
  now(): string;
  onDurableBoundary?: (point: FoundationProviderCredentialDurableBoundaryV1) => void | Promise<void>;
}>) {
  const home = input.codexHome;
  const root = join(home, ROOT), receipts = join(root, "settlements");
  const authPath = join(home, "auth.json"), statePath = join(root, "state.json");
  const originalPath = join(root, "original.auth"), pendingPath = join(root, "pending.json");
  const pendingAuthPath = join(root, "pending.auth"), lockPath = join(root, "lock");
  try {
    if (!isAbsolute(home) || resolve(home) !== home) fail("private-path", "Provider credential home must be one canonical absolute private directory");
    await directory(home); await makeDirectory(root); await makeDirectory(receipts);
    await syncDirectory(home); await syncDirectory(root);
  } catch (error) { sanitized(error); }

  const receiptPath = (selected: FoundationProviderCredentialSubjectV1) => join(receipts, `${digestCanonical(selected).slice(7)}.json`);
  const readState = async () => { const value = await json(statePath); return value === null ? null : parseState(value); };
  const readPending = async () => { const value = await json(pendingPath); return value === null ? null : parsePending(value); };
  const readReceipt = async (selected: FoundationProviderCredentialSubjectV1) => {
    const value = await json(receiptPath(selected));
    if (value === null) return null;
    const receipt = parseReceipt(value);
    if (canonicalJson(receipt.subject) !== canonicalJson(selected)) fail("integrity", "Private provider credential receipt names another execution");
    return receipt;
  };
  const boundary = async (point: FoundationProviderCredentialDurableBoundaryV1) => { await input.onDurableBoundary?.(point); };

  async function locked<T>(action: () => Promise<T>): Promise<T> {
    let handle;
    try {
      await directory(home); await directory(root); await directory(receipts);
      const provider = foundationDescriptorLockProvider();
      if (provider === null) fail("unavailable", "Provider credential locking is unavailable on this host", true);
      handle = await open(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
      const opened = await handle.stat(), entry = await lstat(lockPath);
      assertFile(opened, 0, 0); assertFile(entry, 0, 0);
      if (!sameFile(opened, entry)) fail("private-path", "Private provider credential lock changed while opening");
      const acquired = spawnSync(provider.executable, provider.arguments, { env: {}, stdio: ["ignore", "ignore", "ignore", handle.fd], windowsHide: true });
      if (acquired.status === provider.contentionExitCode) fail("busy", "Another private provider credential transition is active", true);
      if (acquired.error || acquired.status !== 0) fail("unavailable", "Private provider credential locking is unavailable", true);
      return await action();
    } catch (error) { return sanitized(error); }
    finally {
      try { await handle?.close(); }
      catch (error) { sanitized(error); }
    }
  }

  async function receiptInventory(): Promise<number> {
    const entries = await readdir(receipts);
    const complete = entries.filter(name => /^[a-f0-9]{64}\.json$/u.test(name));
    if (entries.some(name => !/^[a-f0-9]{64}\.json(?:\.next)?$/u.test(name)) ||
        complete.length > RECEIPT_LIMIT || entries.length > RECEIPT_LIMIT + 1) {
      fail("integrity", "Private provider credential receipt inventory is invalid");
    }
    for (const name of entries) assertFile(await lstat(join(receipts, name)), 0, METADATA_LIMIT);
    return complete.length;
  }

  function exactClaim(state: State | null, selected: FoundationProviderCredentialSubjectV1): Claim {
    if (state?.active === null || state?.active === undefined || canonicalJson(state.active.subject) !== canonicalJson(selected)) {
      fail("claim-required", "Provider credentials require this exact retained execution claim");
    }
    return state.active;
  }

  async function currentDigest(optional = false): Promise<Sha256 | null> {
    const bytes = await privateBytes(authPath, AUTH_LIMIT);
    if (bytes === null) {
      if (optional) return null;
      fail("unavailable", "The exact private provider credential cache is temporarily unavailable", true);
    }
    try { return sha256Bytes(bytes); } finally { bytes.fill(0); }
  }

  async function unchanged(claim: Claim): Promise<void> {
    if (await currentDigest() !== claim.originalDigest) {
      fail("changed-auth", "Private provider credentials changed during the retained execution claim", true);
    }
  }

  async function original(claim: Claim): Promise<Buffer> {
    const bytes = await privateBytes(originalPath, AUTH_LIMIT);
    if (bytes === null) fail("unavailable", "The exact retained provider credential snapshot is temporarily unavailable", true);
    if (bytes.byteLength !== claim.originalByteLength || sha256Bytes(bytes) !== claim.originalDigest) {
      bytes.fill(0); fail("integrity", "The retained provider credential snapshot changed");
    }
    return bytes;
  }

  /** Resume only an already retained intent for this exact execution. */
  async function resume(selected: FoundationProviderCredentialSubjectV1): Promise<void> {
    const pending = await readPending();
    if (pending === null || canonicalJson(pending.receipt.subject) !== canonicalJson(selected)) return;
    const receipt = pending.receipt, state = await readState();
    if (state === null || state.generation !== receipt.generation ||
        (state.active !== null && (state.active.subjectDigest !== receipt.subjectDigest || state.active.originalDigest !== receipt.originalDigest))) {
      fail("integrity", "Private provider settlement no longer binds its retained generation");
    }
    const retained = await readReceipt(selected);
    if (retained !== null && canonicalJson(retained) !== canonicalJson(receipt)) {
      fail("integrity", "Private provider settlement receipt was substituted");
    }
    if (retained === null) {
      const claim = exactClaim(state, selected);
      const live = await currentDigest(receipt.disposition === "lost");
      if (receipt.disposition === "updated") {
        if (live !== receipt.originalDigest && live !== receipt.resultDigest) {
          fail("changed-auth", "Private provider credentials changed during settlement", true);
        }
        const prepared = await privateBytes(pendingAuthPath, AUTH_LIMIT);
        if (prepared !== null) {
          try {
            if (sha256Bytes(prepared) !== receipt.resultDigest) fail("integrity", "Prepared private provider credential replacement changed");
          } finally { prepared.fill(0); }
        }
        if (live === receipt.originalDigest && (receipt.originalDigest !== receipt.resultDigest || prepared !== null)) {
          if (prepared === null) fail("unavailable", "The exact prepared provider credential replacement is temporarily unavailable", true);
          await unchanged(claim);
          await rename(pendingAuthPath, authPath); await syncDirectory(home); await syncDirectory(root);
          await boundary("credential-replaced");
        }
        if (await currentDigest() !== receipt.resultDigest) fail("changed-auth", "Private provider credential replacement changed before settlement", true);
      } else if (live !== receipt.originalDigest && !(receipt.disposition === "lost" && live === null)) {
        fail("changed-auth", "Private provider credentials changed during settlement", true);
      }
      await writeJson(receiptPath(selected), receipts, receipt);
      await boundary("settlement-retained");
    }
    const stateSubject = { schema: "lifecycle.provider-credential-custody.private.v1" as const,
      generation: receipt.generation, credentialDigest: receipt.resultDigest ?? receipt.originalDigest,
      blockedCredentialDigest: receipt.disposition === "lost" ? receipt.originalDigest : null, active: null };
    await writeJson(statePath, root, { ...stateSubject, digest: selfDigest(stateSubject) });
    await removePrivate(originalPath, AUTH_LIMIT); await removePrivate(pendingAuthPath, AUTH_LIMIT);
    await removePrivate(pendingPath, METADATA_LIMIT); await syncDirectory(root);
  }

  return Object.freeze({
    async hasClaim(value: FoundationProviderCredentialSubjectV1): Promise<boolean> {
      const selected = subject(value);
      return await locked(async () => (await readState())?.active?.subjectDigest === digestCanonical(selected));
    },
    async claim(value: FoundationProviderCredentialSubjectV1): Promise<void> {
      const selected = subject(value);
      await locked(async () => {
        await resume(selected);
        if (await readReceipt(selected) !== null) fail("already-settled", "This exact execution already settled its provider credentials");
        const state = await readState();
        if (state?.active !== null && state?.active !== undefined) {
          if (state.active.subjectDigest !== digestCanonical(selected)) fail("busy", "Another execution retains the exclusive provider session claim", true);
          await unchanged(state.active); const snapshot = await original(state.active); snapshot.fill(0); return;
        }
        if (await readPending() !== null) fail("busy", "A retained provider credential settlement requires exact reconciliation", true);
        if (await receiptInventory() >= RECEIPT_LIMIT) fail("receipt-bound", "Provider credential settlement custody awaits exact Reclamation", true);
        const bytes = await privateBytes(authPath, AUTH_LIMIT);
        if (bytes === null) fail("unavailable", "Private provider credentials must be supplied before claiming the session", true);
        try {
          const originalDigest = sha256Bytes(bytes);
          if (state?.blockedCredentialDigest === originalDigest) {
            fail("reprovision-required", "Provider authentication was lost; a different freshly supplied private credential is required", true);
          }
          const nextGeneration = (state?.generation ?? 0) + 1; generation(nextGeneration);
          const active: Claim = { subject: selected, subjectDigest: digestCanonical(selected), generation: nextGeneration,
            originalDigest, originalByteLength: bytes.byteLength, claimedAt: timestamp(input.now()) };
          await writePrivate(originalPath, root, bytes, AUTH_LIMIT);
          if (await currentDigest() !== originalDigest) fail("changed-auth", "Private provider credentials changed before the claim was retained", true);
          const stateSubject = { schema: "lifecycle.provider-credential-custody.private.v1" as const,
            generation: nextGeneration, credentialDigest: originalDigest, blockedCredentialDigest: null, active };
          await writeJson(statePath, root, { ...stateSubject, digest: selfDigest(stateSubject) });
          await boundary("claim-retained");
        } finally { bytes.fill(0); }
      });
    },
    async read(value: FoundationProviderCredentialSubjectV1) {
      const selected = subject(value);
      const opening = await locked(async () => {
        const claim = exactClaim(await readState(), selected); await unchanged(claim);
        const bytes = await original(claim);
        try { return { byteLength: bytes.byteLength, generation: claim.generation, originalDigest: claim.originalDigest }; }
        finally { bytes.fill(0); }
      });
      let consumed = false;
      return Object.freeze({ byteLength: opening.byteLength, read(): AsyncIterable<Uint8Array> {
        if (consumed) fail("reader-reused", "The private provider credential reader is single-use");
        consumed = true;
        return (async function* () {
          const bytes = await locked(async () => {
            const claim = exactClaim(await readState(), selected);
            if (claim.generation !== opening.generation || claim.originalDigest !== opening.originalDigest) {
              fail("claim-required", "The private credential reader no longer binds its original claim");
            }
            await unchanged(claim); return await original(claim);
          });
          try { yield bytes; } finally { bytes.fill(0); }
        })();
      } });
    },
    async settlement(value: FoundationProviderCredentialSubjectV1): Promise<FoundationProviderCredentialSettlementReceiptV1 | null> {
      const selected = subject(value);
      return await locked(async () => { await resume(selected); return await readReceipt(selected); });
    },
    async settle(value: FoundationProviderCredentialSubjectV1, outcome: FoundationProviderCredentialSettlementV1): Promise<FoundationProviderCredentialSettlementReceiptV1> {
      let bytes: Uint8Array | null = null;
      try {
        if (outcome.kind === "updated") {
          if (!(outcome.bytes instanceof Uint8Array)) fail("updated-bytes", "Provider credential replacement must be bounded private bytes");
          if (outcome.bytes.byteLength < 2 || outcome.bytes.byteLength > AUTH_LIMIT) {
            outcome.bytes.fill(0); fail("updated-bytes", "Provider credential replacement must be bounded private bytes");
          }
          bytes = Uint8Array.from(outcome.bytes); outcome.bytes.fill(0);
        } else if (outcome.kind !== "unused" && outcome.kind !== "lost") fail("integrity", "Provider credential settlement disposition is invalid");
        const selected = subject(value), resultDigest = bytes === null ? null : sha256Bytes(bytes);
        return await locked(async () => {
          const pending = await readPending();
          if (pending !== null && pending.receipt.subjectDigest === digestCanonical(selected) &&
              (pending.receipt.disposition !== outcome.kind || (outcome.kind === "updated" && pending.receipt.resultDigest !== resultDigest))) {
            fail("settlement-substitution", "Provider credential settlement retry changed its retained outcome");
          }
          await resume(selected);
          const retained = await readReceipt(selected);
          if (retained !== null) {
            if (retained.disposition !== outcome.kind || (outcome.kind === "updated" && retained.resultDigest !== resultDigest)) {
              fail("settlement-substitution", "Provider credential settlement retry changed its retained outcome");
            }
            return retained;
          }
          const claim = exactClaim(await readState(), selected);
          if (await readPending() !== null) fail("integrity", "Another provider credential settlement occupies the retained claim");
          const live = await currentDigest(outcome.kind === "lost");
          if (live !== claim.originalDigest && !(outcome.kind === "lost" && live === null)) {
            fail("changed-auth", "Private provider credentials changed during the retained execution claim", true);
          }
          const receiptSubject = { schema: "lifecycle.provider-credential-settlement.private.v1" as const,
            subject: selected, subjectDigest: claim.subjectDigest, generation: claim.generation,
            disposition: outcome.kind, originalDigest: claim.originalDigest,
            resultDigest: outcome.kind === "updated" ? resultDigest : outcome.kind === "unused" ? claim.originalDigest : null,
            settledAt: timestamp(input.now()) };
          const receipt: FoundationProviderCredentialSettlementReceiptV1 = { ...receiptSubject, digest: selfDigest(receiptSubject) };
          if (bytes !== null) await writePrivate(pendingAuthPath, root, bytes, AUTH_LIMIT);
          const pendingSubject = { schema: "lifecycle.provider-credential-pending.private.v1" as const, receipt };
          await writeJson(pendingPath, root, { ...pendingSubject, digest: selfDigest(pendingSubject) });
          await boundary("settlement-prepared"); await resume(selected);
          return receipt;
        });
      } catch (error) { sanitized(error); }
      finally { bytes?.fill(0); }
    },
    /**
     * Caller supplies exact physical Reclamation or conclusive primary and
     * provisional resource absence for an unused unallocated claim. Absence is
     * idempotent; neither cleanup proof is inferred from this private receipt.
     */
    async forgetSettlement(value: FoundationProviderCredentialSubjectV1): Promise<void> {
      const selected = subject(value);
      await locked(async () => {
        if ((await readState())?.active?.subjectDigest === digestCanonical(selected) ||
            (await readPending())?.receipt.subjectDigest === digestCanonical(selected)) {
          fail("claim-required", "A terminal provider credential settlement is required before Reclamation forgets it");
        }
        if (await readReceipt(selected) === null) return;
        await removePrivate(receiptPath(selected), METADATA_LIMIT); await syncDirectory(receipts);
      });
    },
  });
}
