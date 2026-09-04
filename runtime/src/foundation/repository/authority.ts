import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { FoundationError } from "../error.js";
import { canonicalJson, digestCanonical, type Sha256 } from "../validation/canonical.js";
import { atomicWrite, ensureDirectory } from "../support/filesystem.js";
import { opaqueId, text } from "../validation/value.js";
import type { FoundationAuthorityIdentity, FoundationRepositoryContract } from "./types.js";

function authorityDirectory(home: string, targetId: string): string {
  return join(home, "authorities", opaqueId(targetId, "Authority target identity"));
}

function privateKeyPath(home: string, targetId: string, keyId: string): string {
  return join(authorityDirectory(home, targetId), `${opaqueId(keyId, "Authority key identity")}.pem`);
}

export function validateAuthoritySecret(value: string | undefined): string {
  if (value === undefined || Buffer.byteLength(value, "utf8") < 32 || Buffer.byteLength(value, "utf8") > 4096 || value.includes("\0")) {
    throw new FoundationError("lifecycle.authority.secret", "Authority operation requires 32 to 4096 secret bytes from an owner-private carrier");
  }
  return value;
}

export async function createFoundationAuthority(home: string, targetId: string, authoritySecret: string, principalId = "founder"): Promise<FoundationAuthorityIdentity> {
  const secret = validateAuthoritySecret(authoritySecret);
  const pair = generateKeyPairSync("ed25519");
  const publicDer = pair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const keyId = `founder-${digestCanonical(publicDer.toString("base64")).slice("sha256:".length, "sha256:".length + 20)}`;
  const directory = authorityDirectory(home, targetId);
  await ensureDirectory(directory);
  const path = privateKeyPath(home, targetId, keyId);
  await atomicWrite(path, pair.privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: secret }) as string, 0o600);
  await chmod(path, 0o600);
  return Object.freeze({ principalId, keyId, publicKey: `ed25519:${publicDer.toString("base64")}` });
}

async function unlock(options: { home: string; contract: FoundationRepositoryContract; authoritySecret: string }): Promise<KeyObject> {
  const secret = validateAuthoritySecret(options.authoritySecret);
  const path = privateKeyPath(options.home, options.contract.targetId, options.contract.authority.keyId);
  let pem: string;
  try {
    pem = await readFile(path, "utf8");
  } catch (error) {
    throw new FoundationError("lifecycle.authority.private-key", "Machine authority key is unavailable", { observedFacts: { path, cause: error instanceof Error ? error.message : String(error) } });
  }
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: pem, format: "pem", passphrase: secret });
  } catch {
    throw new FoundationError("lifecycle.authority.secret-invalid", "Authority secret cannot unlock the target signing key");
  }
  const publicDer = createPublicKey({ key: pem, format: "pem", passphrase: secret } as unknown as Parameters<typeof createPublicKey>[0]).export({ type: "spki", format: "der" }) as Buffer;
  if (`ed25519:${publicDer.toString("base64")}` !== options.contract.authority.publicKey) throw new FoundationError("lifecycle.authority.key-mismatch", "Machine authority key does not match the repository trust root");
  return privateKey;
}

export async function authenticateFoundationAuthority(options: { home: string; contract: FoundationRepositoryContract; authoritySecret: string }): Promise<void> {
  await unlock(options);
}

export async function signFoundationSubject(options: { home: string; contract: FoundationRepositoryContract; authoritySecret: string; subject: unknown }): Promise<{ subjectDigest: Sha256; signature: `ed25519:${string}` }> {
  const privateKey = await unlock(options);
  const encoded = canonicalJson(options.subject);
  return { subjectDigest: digestCanonical(options.subject), signature: `ed25519:${sign(null, Buffer.from(encoded), privateKey).toString("base64url")}` };
}

export function verifyFoundationSubject(options: { contract: FoundationRepositoryContract; subject: unknown; subjectDigest: Sha256; signature: `ed25519:${string}` }): void {
  if (digestCanonical(options.subject) !== options.subjectDigest) throw new FoundationError("lifecycle.authority.subject", "Authority subject digest is stale or invalid");
  const signature = text(options.signature, "Authority signature", 8192);
  if (!/^ed25519:[A-Za-z0-9_-]+$/u.test(signature)) throw new FoundationError("lifecycle.authority.signature", "Authority signature must be one unpadded Ed25519 base64url value");
  const publicKey = createPublicKey({ key: Buffer.from(options.contract.authority.publicKey.slice("ed25519:".length), "base64"), type: "spki", format: "der" });
  if (!verify(null, Buffer.from(canonicalJson(options.subject)), publicKey, Buffer.from(signature.slice("ed25519:".length), "base64url"))) {
    throw new FoundationError("lifecycle.authority.signature", "Authority signature does not verify against the repository trust root");
  }
}
