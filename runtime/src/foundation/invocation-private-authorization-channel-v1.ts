import { Buffer } from "node:buffer";
import type { BigIntStats } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { LifecycleError } from "../errors.js";
import { discardFoundationAuthorityCredential, receiveFoundationAuthorityCredential, type FoundationAuthorityCredential } from "./repository/authority.js";

export const FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_CHALLENGE_MAXIMUM_BYTES = 96;
export const FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_SECRET_MINIMUM_BYTES = 32;
export const FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_SECRET_MAXIMUM_BYTES = 4_096;

const REQUEST_MAGIC = Buffer.from("LCW1", "ascii");
const RESPONSE_MAGIC = Buffer.from("LCWR", "ascii");
const REQUEST_HEADER_BYTES = 8;
const RESPONSE_HEADER_BYTES = 8;
const RESPONSE_MAXIMUM_BYTES = 4_096;
const REQUEST_MAXIMUM_BYTES = REQUEST_HEADER_BYTES
  + FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_CHALLENGE_MAXIMUM_BYTES
  + FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_SECRET_MAXIMUM_BYTES;
const REQUEST_READ_TIMEOUT_MS = 5_000;
const PREFLIGHT_LIVENESS_TIMEOUT_MS = 5_000;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const CHALLENGE_PATTERN = /^(lcw1\.([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43}))$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export type FoundationInvocationPrivateAuthorizationChallengeV1 = Readonly<{
  token: string;
  invocationId: string;
}>;

export type FoundationInvocationPrivateAuthorizationHandoffResultV1 = Readonly<{
  kind: "invocation-private-authorization-result";
  invocationId: string;
  operation: "delivery.admit" | "delivery.accept" | "delivery.no-ship";
  deliveryId: string;
  status: "completed" | "refused" | "recovery-required";
  resultDigest: `sha256:${string}`;
}>;

export type FoundationInvocationPrivateAuthorizationChannelServerV1 = Readonly<{
  socketPath: string;
  close(): Promise<void>;
}>;

type HandoffRefusal = Readonly<{
  kind: "invocation-private-authorization-refusal";
  invocationId: string;
  code: "authorization-refused";
}>;

type HandoffObservationUnavailable = Readonly<{
  kind: "invocation-private-authorization-observation-unavailable";
  invocationId: string;
  code: "authorization-result-unavailable";
}>;

type HandoffResponse = FoundationInvocationPrivateAuthorizationHandoffResultV1 | HandoffRefusal | HandoffObservationUnavailable;
const noHandlerRefusals = new WeakSet<LifecycleError>();
const unavailableObservations = new WeakSet<LifecycleError>();

function observationUnavailable(invocationId: string): LifecycleError {
  const error = new LifecycleError({
    code: "runtime.authorization-result-unavailable",
    message: "Authorization may have been submitted, but its result could not be observed. Return to the originating view and refresh the Delivery before choosing another action.",
    retryable: false,
    repositoryChanged: null,
    operationalStateChanged: null,
    observedFacts: Object.freeze({ invocationId, authorizationSubmission: "may-have-started" }),
  });
  unavailableObservations.add(error);
  return error;
}

/** Recognize only an observation failure constructed by this channel owner. */
export function isFoundationInvocationPrivateAuthorizationObservationUnavailableV1(
  error: unknown,
): error is LifecycleError {
  return error instanceof LifecycleError && unavailableObservations.has(error);
}

type SocketIdentity = Readonly<{
  device: bigint;
  inode: bigint;
}>;

function fail(code: string, message: string, retryable = false): never {
  throw new LifecycleError({ code, message, retryable });
}

function currentUid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function exactInvocationId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail(
      "runtime.authorization-challenge-invalid",
      "Invocation-private authorization requires one exact challenge",
    );
  }
  return value;
}

export function parseFoundationInvocationPrivateAuthorizationChallengeV1(
  value: unknown,
): FoundationInvocationPrivateAuthorizationChallengeV1 | null {
  if (
    typeof value !== "string"
    || Buffer.byteLength(value, "ascii") >
      FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_CHALLENGE_MAXIMUM_BYTES
    || !/^[\x20-\x7e]+$/u.test(value)
  ) return null;
  const match = CHALLENGE_PATTERN.exec(value);
  if (match === null || match[1] !== value || match[2] === undefined) return null;
  return Object.freeze({ token: value, invocationId: match[2] });
}

function defaultSocketRoot(): string {
  if (process.platform === "win32") {
    fail(
      "runtime.authorization-channel-unsupported",
      "Invocation-private authorization requires the selected Unix Runtime environment",
    );
  }
  const uid = currentUid();
  if (uid === null || !Number.isSafeInteger(uid) || uid < 0) {
    fail(
      "runtime.authorization-channel-unavailable",
      "Invocation-private authorization cannot resolve the Runtime owner",
    );
  }
  return join(process.platform === "darwin" ? "/private/tmp" : "/tmp", `lcw-${uid}`);
}

export function foundationInvocationPrivateAuthorizationSocketPathV1(
  invocationId: string,
  socketRoot?: string,
): string {
  const selectedInvocationId = exactInvocationId(invocationId);
  const selectedRoot = socketRoot === undefined ? defaultSocketRoot() : socketRoot;
  if (
    typeof selectedRoot !== "string"
    || selectedRoot.length === 0
    || selectedRoot.includes("\0")
    || !isAbsolute(selectedRoot)
    || Buffer.byteLength(selectedRoot, "utf8") > 512
  ) {
    fail(
      "runtime.authorization-channel-unavailable",
      "Invocation-private authorization socket custody is invalid",
    );
  }
  const physicalRoot = resolve(selectedRoot);
  if (physicalRoot === parse(physicalRoot).root) {
    fail(
      "runtime.authorization-channel-unavailable",
      "Invocation-private authorization socket custody cannot be a filesystem root",
    );
  }
  const socketPath = join(physicalRoot, `${selectedInvocationId}.sock`);
  if (Buffer.byteLength(socketPath, "utf8") > 100) {
    fail(
      "runtime.authorization-channel-unavailable",
      "Invocation-private authorization socket address exceeds its portable bound",
    );
  }
  return socketPath;
}

async function exactPrivateDirectory(path: string, create: boolean): Promise<void> {
  if (create) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  let status: BigIntStats;
  try {
    status = await lstat(path, { bigint: true });
  } catch {
    fail(
      "runtime.authorization-channel-unavailable",
      "Invocation-private authorization socket custody is unavailable",
    );
  }
  const uid = currentUid();
  if (
    !status.isDirectory()
    || status.isSymbolicLink()
    || (status.mode & 0o777n) !== 0o700n
    || (uid !== null && status.uid !== BigInt(uid))
  ) {
    fail(
      "runtime.authorization-channel-unavailable",
      "Invocation-private authorization socket custody is not owner-private",
    );
  }
}

async function exactPrivateSocket(path: string): Promise<SocketIdentity> {
  let status: BigIntStats;
  try {
    status = await lstat(path, { bigint: true });
  } catch {
    fail(
      "runtime.authorization-invocation-unavailable",
      "The selected authorization invocation is unavailable",
      true,
    );
  }
  const uid = currentUid();
  if (
    !status.isSocket()
    || status.isSymbolicLink()
    || (status.mode & 0o777n) !== 0o600n
    || (uid !== null && status.uid !== BigInt(uid))
  ) {
    fail(
      "runtime.authorization-invocation-unavailable",
      "The selected authorization invocation is not owner-private",
      true,
    );
  }
  return Object.freeze({ device: status.dev, inode: status.ino });
}

function sameSocketIdentity(left: SocketIdentity, right: SocketIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

async function resolveInvocationPrivateAuthorizationAvailability(
  challenge: string,
  socketRoot?: string,
): Promise<Readonly<{
  challenge: FoundationInvocationPrivateAuthorizationChallengeV1;
  socketPath: string;
  socketIdentity: SocketIdentity;
}>> {
  const parsed = parseFoundationInvocationPrivateAuthorizationChallengeV1(challenge);
  if (parsed === null) {
    fail(
      "runtime.authorization-challenge-invalid",
      "Invocation-private authorization requires one exact challenge",
    );
  }
  const socketPath = foundationInvocationPrivateAuthorizationSocketPathV1(
    parsed.invocationId,
    socketRoot,
  );
  await exactPrivateDirectory(dirname(socketPath), false);
  return Object.freeze({
    challenge: parsed,
    socketPath,
    socketIdentity: await exactPrivateSocket(socketPath),
  });
}

/** Establish that one exact owner-private invocation is currently available. */
export async function preflightFoundationInvocationPrivateAuthorizationV1(
  challenge: string,
  socketRoot?: string,
): Promise<void> {
  const available = await resolveInvocationPrivateAuthorizationAvailability(challenge, socketRoot);
  const socket = createConnection({ path: available.socketPath });
  socket.on("error", () => undefined);
  const responseTask = readAuthorizationResponse(socket);
  void responseTask.catch(() => undefined);
  const timeout = setTimeout(() => {
    socket.destroy(new Error("authorization invocation liveness probe timed out"));
  }, PREFLIGHT_LIVENESS_TIMEOUT_MS);
  try {
    await waitForSocketConnection(socket);
    const after = await exactPrivateSocket(available.socketPath);
    if (!sameSocketIdentity(available.socketIdentity, after)) {
      fail(
        "runtime.authorization-invocation-unavailable",
        "The selected authorization invocation changed during liveness probing",
        true,
      );
    }
    socket.end();
    const response = await responseTask;
    let exactRefusal = false;
    try {
      decodeResponse(response, available.challenge.invocationId);
    } catch (error) {
      exactRefusal = error instanceof LifecycleError
        && error.code === "runtime.authorization-refused";
    } finally {
      response.fill(0);
    }
    if (!exactRefusal) {
      fail(
        "runtime.authorization-invocation-unavailable",
        "The selected authorization invocation failed its liveness probe",
        true,
      );
    }
  } catch (error) {
    if (error instanceof LifecycleError
      && error.code === "runtime.authorization-invocation-unavailable") throw error;
    fail(
      "runtime.authorization-invocation-unavailable",
      "The selected authorization invocation is unavailable",
      true,
    );
  } finally {
    clearTimeout(timeout);
    socket.destroy();
  }
}

function exactSecretBytes(value: Uint8Array): Buffer {
  if (
    !(value instanceof Uint8Array)
    || value.byteLength < FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_SECRET_MINIMUM_BYTES
    || value.byteLength > FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_SECRET_MAXIMUM_BYTES
  ) {
    fail(
      "cli.authority-secret-file",
      "--authority-secret-file must contain 32 through 4096 UTF-8 secret bytes",
    );
  }
  const retained = Buffer.from(value);
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(retained);
  } catch {
    retained.fill(0);
    fail(
      "cli.authority-secret-file",
      "--authority-secret-file must contain valid UTF-8 secret bytes",
    );
  }
  if (decoded.includes("\0")) {
    retained.fill(0);
    fail(
      "cli.authority-secret-file",
      "--authority-secret-file must not contain NUL bytes",
    );
  }
  return retained;
}

function encodeRequest(challenge: string, authoritySecret: Uint8Array): Buffer {
  const parsed = parseFoundationInvocationPrivateAuthorizationChallengeV1(challenge);
  if (parsed === null) {
    fail(
      "runtime.authorization-challenge-invalid",
      "Invocation-private authorization requires one exact challenge",
    );
  }
  const token = Buffer.from(parsed.token, "ascii");
  const secret = exactSecretBytes(authoritySecret);
  const frame = Buffer.alloc(REQUEST_HEADER_BYTES + token.byteLength + secret.byteLength);
  try {
    REQUEST_MAGIC.copy(frame, 0);
    frame.writeUInt16BE(token.byteLength, 4);
    frame.writeUInt16BE(secret.byteLength, 6);
    token.copy(frame, REQUEST_HEADER_BYTES);
    secret.copy(frame, REQUEST_HEADER_BYTES + token.byteLength);
    return frame;
  } finally {
    token.fill(0);
    secret.fill(0);
  }
}

function decodeRequest(
  frame: Buffer,
  invocationId: string,
): Readonly<{ challenge: string; authorityCredential: FoundationAuthorityCredential }> | null {
  if (
    frame.byteLength < REQUEST_HEADER_BYTES
    || !frame.subarray(0, 4).equals(REQUEST_MAGIC)
  ) return null;
  const tokenLength = frame.readUInt16BE(4);
  const secretLength = frame.readUInt16BE(6);
  if (
    tokenLength === 0
    || tokenLength > FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_CHALLENGE_MAXIMUM_BYTES
    || secretLength < FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_SECRET_MINIMUM_BYTES
    || secretLength > FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_SECRET_MAXIMUM_BYTES
    || frame.byteLength !== REQUEST_HEADER_BYTES + tokenLength + secretLength
  ) return null;
  const tokenBytes = frame.subarray(REQUEST_HEADER_BYTES, REQUEST_HEADER_BYTES + tokenLength);
  if ([...tokenBytes].some((byte) => byte < 0x20 || byte > 0x7e)) return null;
  const challenge = tokenBytes.toString("ascii");
  const parsed = parseFoundationInvocationPrivateAuthorizationChallengeV1(challenge);
  if (parsed === null || parsed.invocationId !== invocationId) return null;
  const secretBytes = frame.subarray(REQUEST_HEADER_BYTES + tokenLength);
  let authoritySecret: string;
  try {
    authoritySecret = new TextDecoder("utf-8", { fatal: true }).decode(secretBytes);
  } catch {
    return null;
  }
  if (authoritySecret.includes("\0")) return null;
  return Object.freeze({ challenge, authorityCredential: receiveFoundationAuthorityCredential(authoritySecret, "director-decision") });
}

function retainResult(value: unknown): FoundationInvocationPrivateAuthorizationHandoffResultV1 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (Object.keys(result).sort().join("\0") !== [
    "deliveryId", "invocationId", "kind", "operation", "resultDigest", "status",
  ].sort().join("\0")) return null;
  if (
    result.kind !== "invocation-private-authorization-result"
    || typeof result.invocationId !== "string" || !UUID_PATTERN.test(result.invocationId)
    || typeof result.deliveryId !== "string" || result.deliveryId.length > 512
    || !OPAQUE_ID_PATTERN.test(result.deliveryId)
    || (result.operation !== "delivery.admit"
      && result.operation !== "delivery.accept"
      && result.operation !== "delivery.no-ship")
    || (result.status !== "completed"
      && result.status !== "refused"
      && result.status !== "recovery-required")
    || typeof result.resultDigest !== "string" || !SHA256_PATTERN.test(result.resultDigest)
  ) return null;
  return Object.freeze({
    kind: "invocation-private-authorization-result",
    invocationId: result.invocationId,
    operation: result.operation,
    deliveryId: result.deliveryId,
    status: result.status,
    resultDigest: result.resultDigest as `sha256:${string}`,
  });
}

export function createFoundationInvocationPrivateAuthorizationHandoffResultV1(
  value: unknown,
): FoundationInvocationPrivateAuthorizationHandoffResultV1 {
  const retained = retainResult(value);
  if (retained === null) {
    fail(
      "runtime.authorization-channel-result",
      "Invocation-private authorization returned an invalid bounded result",
    );
  }
  return retained;
}

function refusal(invocationId: string): HandoffRefusal {
  return Object.freeze({
    kind: "invocation-private-authorization-refusal",
    invocationId,
    code: "authorization-refused",
  });
}

function unavailable(invocationId: string): HandoffObservationUnavailable {
  return Object.freeze({
    kind: "invocation-private-authorization-observation-unavailable",
    invocationId,
    code: "authorization-result-unavailable",
  });
}

function encodeResponse(value: HandoffResponse): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.byteLength > RESPONSE_MAXIMUM_BYTES) {
    payload.fill(0);
    return encodeResponse(unavailable(value.invocationId));
  }
  const frame = Buffer.alloc(RESPONSE_HEADER_BYTES + payload.byteLength);
  RESPONSE_MAGIC.copy(frame, 0);
  frame.writeUInt32BE(payload.byteLength, 4);
  payload.copy(frame, RESPONSE_HEADER_BYTES);
  payload.fill(0);
  return frame;
}

function decodeResponse(
  frame: Buffer,
  invocationId: string,
): FoundationInvocationPrivateAuthorizationHandoffResultV1 {
  if (
    frame.byteLength < RESPONSE_HEADER_BYTES
    || !frame.subarray(0, 4).equals(RESPONSE_MAGIC)
  ) {
    fail(
      "runtime.authorization-channel-response",
      "The authorization invocation returned an invalid response",
      true,
    );
  }
  const payloadLength = frame.readUInt32BE(4);
  if (
    payloadLength === 0
    || payloadLength > RESPONSE_MAXIMUM_BYTES
    || frame.byteLength !== RESPONSE_HEADER_BYTES + payloadLength
  ) {
    fail(
      "runtime.authorization-channel-response",
      "The authorization invocation returned an invalid response",
      true,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame.subarray(8)));
  } catch {
    fail(
      "runtime.authorization-channel-response",
      "The authorization invocation returned an invalid response",
      true,
    );
  }
  const retained = retainResult(decoded);
  if (retained !== null && retained.invocationId === invocationId) return retained;
  if (
    typeof decoded === "object" && decoded !== null && !Array.isArray(decoded)
    && Object.keys(decoded).sort().join("\0") === ["code", "invocationId", "kind"].sort().join("\0")
    && (decoded as Record<string, unknown>).kind === "invocation-private-authorization-refusal"
    && (decoded as Record<string, unknown>).invocationId === invocationId
    && (decoded as Record<string, unknown>).code === "authorization-refused"
  ) {
    const error = new LifecycleError({
      code: "runtime.authorization-refused",
      message: "The selected invocation refused this authorization challenge before starting its handler",
    });
    noHandlerRefusals.add(error);
    throw error;
  }
  if (
    typeof decoded === "object" && decoded !== null && !Array.isArray(decoded)
    && Object.keys(decoded).sort().join("\0") === ["code", "invocationId", "kind"].sort().join("\0")
    && (decoded as Record<string, unknown>).kind === "invocation-private-authorization-observation-unavailable"
    && (decoded as Record<string, unknown>).invocationId === invocationId
    && (decoded as Record<string, unknown>).code === "authorization-result-unavailable"
  ) {
    throw observationUnavailable(invocationId);
  }
  fail(
    "runtime.authorization-channel-response",
    "The authorization invocation returned an invalid response",
    true,
  );
}

async function readRequest(socket: Socket): Promise<Buffer | null> {
  const retained = Buffer.alloc(REQUEST_MAXIMUM_BYTES + 1);
  let length = 0;
  let expectedLength: number | null = null;
  return await new Promise<Buffer | null>((resolveRead) => {
    let settled = false;
    const finish = (valid: boolean): void => {
      if (settled) return;
      settled = true;
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      socket.setTimeout(0);
      const selected = valid ? Buffer.from(retained.subarray(0, length)) : null;
      retained.fill(0);
      resolveRead(selected);
    };
    const refuse = (): void => {
      socket.pause();
      finish(false);
    };
    const onData = (chunk: Buffer): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (length + bytes.byteLength > retained.byteLength) {
        refuse();
        return;
      }
      bytes.copy(retained, length);
      length += bytes.byteLength;
      if (expectedLength === null && length >= REQUEST_HEADER_BYTES) {
        if (!retained.subarray(0, 4).equals(REQUEST_MAGIC)) {
          refuse();
          return;
        }
        const tokenLength = retained.readUInt16BE(4);
        const secretLength = retained.readUInt16BE(6);
        if (
          tokenLength === 0
          || tokenLength > FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_CHALLENGE_MAXIMUM_BYTES
          || secretLength < FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_SECRET_MINIMUM_BYTES
          || secretLength > FOUNDATION_INVOCATION_PRIVATE_AUTHORIZATION_SECRET_MAXIMUM_BYTES
        ) {
          refuse();
          return;
        }
        expectedLength = REQUEST_HEADER_BYTES + tokenLength + secretLength;
      }
      if (expectedLength !== null && length > expectedLength) refuse();
    };
    const onEnd = (): void => finish(expectedLength !== null && length === expectedLength);
    const onError = (): void => finish(false);
    const onTimeout = (): void => refuse();
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.setTimeout(REQUEST_READ_TIMEOUT_MS);
  });
}

async function writeResponse(
  socket: Socket,
  value: HandoffResponse,
  beforeWrite?: () => void,
): Promise<void> {
  const response = encodeResponse(value);
  try {
    await new Promise<void>((resolveWrite, rejectWrite) => {
      if (socket.destroyed) {
        resolveWrite();
        return;
      }
      const onError = (error: Error): void => {
        socket.off("error", onError);
        rejectWrite(error);
      };
      socket.once("error", onError);
      beforeWrite?.();
      socket.end(response, (error?: Error | null) => {
        socket.off("error", onError);
        if (error) rejectWrite(error);
        else resolveWrite();
      });
    });
  } finally {
    response.fill(0);
  }
}

async function removeExactSocket(path: string, identity: SocketIdentity): Promise<void> {
  const current = await lstat(path, { bigint: true });
  if (
    current.dev !== identity.device
    || current.ino !== identity.inode
  ) {
    fail(
      "runtime.authorization-channel-cleanup",
      "Invocation-private authorization socket identity changed before cleanup",
    );
  }
  await unlink(path);
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
  });
}

async function pathIdentity(path: string): Promise<SocketIdentity | null> {
  try {
    const status = await lstat(path, { bigint: true });
    return Object.freeze({ device: status.dev, inode: status.ino });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Node unlinks a Unix socket pathname by name during close. Move the observed
 * entry aside and leave an identity-bound marker in that name so Node cannot
 * delete a substituted filesystem object. Restore a substitution after the
 * listener is closed; delete only the exact socket this invocation created.
 */
async function closeIdentityBoundServer(
  server: Server,
  socketPath: string,
  expectedIdentity: SocketIdentity,
  settlement: Promise<void> | null,
): Promise<void> {
  const holdingPath = `${socketPath}.closing`;
  if (await pathIdentity(holdingPath) !== null) {
    fail(
      "runtime.authorization-channel-cleanup",
      "Invocation-private authorization cleanup carrier is occupied",
    );
  }
  let movedIdentity: SocketIdentity | null = null;
  try {
    await rename(socketPath, holdingPath);
    movedIdentity = await pathIdentity(holdingPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let markerIdentity: SocketIdentity;
  try {
    const marker = await open(socketPath, "wx", 0o600);
    try {
      const status = await marker.stat({ bigint: true });
      markerIdentity = Object.freeze({ device: status.dev, inode: status.ino });
    } finally {
      await marker.close();
    }
  } catch (error) {
    if (movedIdentity !== null && await pathIdentity(socketPath) === null) {
      await rename(holdingPath, socketPath).catch(() => undefined);
    }
    throw error;
  }

  let closeError: unknown;
  try {
    await closeServer(server);
  } catch (error) {
    closeError = error;
  }
  try {
    await settlement;
  } catch (error) {
    closeError ??= error;
  }

  const currentMarker = await pathIdentity(socketPath);
  if (currentMarker !== null && sameSocketIdentity(currentMarker, markerIdentity)) {
    await unlink(socketPath);
  } else if (currentMarker !== null) {
    closeError ??= new LifecycleError({
      code: "runtime.authorization-channel-cleanup",
      message: "Invocation-private authorization socket name changed during cleanup",
    });
  }

  if (movedIdentity === null) {
    closeError ??= new LifecycleError({
      code: "runtime.authorization-channel-cleanup",
      message: "Invocation-private authorization socket disappeared before cleanup",
    });
  } else if (sameSocketIdentity(movedIdentity, expectedIdentity)) {
    try {
      await removeExactSocket(holdingPath, expectedIdentity);
    } catch (error) {
      closeError ??= error;
    }
  } else {
    if (await pathIdentity(socketPath) === null) {
      try {
        await rename(holdingPath, socketPath);
      } catch (error) {
        closeError ??= error;
      }
    }
    closeError ??= new LifecycleError({
      code: "runtime.authorization-channel-cleanup",
      message: "Invocation-private authorization socket identity was substituted before cleanup",
    });
  }
  if (closeError !== undefined) throw closeError;
}

/**
 * Start one owner-private, invocation-scoped local authorization channel.
 * The handler receives no socket, path, framing, or browser state.
 */
export async function startFoundationInvocationPrivateAuthorizationChannelServerV1(
  input: Readonly<{
    invocationId: string;
    socketRoot?: string;
    handle(request: Readonly<{ challenge: string; authorityCredential: FoundationAuthorityCredential }> ):
      Promise<FoundationInvocationPrivateAuthorizationHandoffResultV1>;
  }>,
): Promise<FoundationInvocationPrivateAuthorizationChannelServerV1> {
  const invocationId = exactInvocationId(input.invocationId);
  if (typeof input.handle !== "function") {
    fail(
      "runtime.authorization-channel-unavailable",
      "Invocation-private authorization has no fixed Runtime handler",
    );
  }
  const socketPath = foundationInvocationPrivateAuthorizationSocketPathV1(
    invocationId,
    input.socketRoot,
  );
  const socketRoot = dirname(socketPath);
  await exactPrivateDirectory(socketRoot, true);
  try {
    await lstat(socketPath);
    fail(
      "runtime.authorization-channel-unavailable",
      "Invocation-private authorization socket address is already occupied",
    );
  } catch (error) {
    if (error instanceof LifecycleError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let busy = false;
  let closing = false;
  let activeSocket: Socket | null = null;
  let handlerStarted = false;
  let activeHandler: Promise<void> | null = null;
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    // A peer may disappear after Runtime has claimed and durably opened the
    // authority operation. Transport loss is then non-semantic; the browser
    // refreshes Runtime truth and this listener prevents a late EPIPE from
    // escaping the already-settled channel task.
    socket.on("error", () => undefined);
    if (closing || busy) {
      void (async () => {
        const rejectedFrame = await readRequest(socket);
        rejectedFrame?.fill(0);
        await writeResponse(socket, refusal(invocationId));
      })().catch(() => undefined).finally(() => socket.destroy());
      return;
    }
    busy = true;
    activeSocket = socket;
    const operation = (async () => {
      let requestFrame: Buffer | null = null;
      let authorityCredential: FoundationAuthorityCredential | undefined;
      let responseStarted = false;
      const respond = (value: HandoffResponse) => writeResponse(socket, value, () => { responseStarted = true; });
      try {
        requestFrame = await readRequest(socket);
        const request = requestFrame === null ? null : decodeRequest(requestFrame, invocationId);
        if (request === null) {
          await respond(refusal(invocationId));
          return;
        }
        authorityCredential = request.authorityCredential;
        handlerStarted = true;
        const result = createFoundationInvocationPrivateAuthorizationHandoffResultV1(
          await input.handle(request),
        );
        if (result.invocationId !== invocationId) {
          await respond(unavailable(invocationId));
          return;
        }
        await respond(result);
      } catch {
        // A callback may have committed an effect before throwing. A write may
        // have sent part of the result. Neither permits a no-handler refusal.
        if (!responseStarted) {
          await respond(handlerStarted ? unavailable(invocationId) : refusal(invocationId)).catch(() => undefined);
        }
      } finally {
        discardFoundationAuthorityCredential(authorityCredential);
        requestFrame?.fill(0);
        if (!socket.destroyed) socket.destroy();
        busy = false;
        activeSocket = null;
        handlerStarted = false;
        activeHandler = null;
      }
    })();
    activeHandler = operation;
    void operation;
  });

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error): void => rejectListen(error);
      server.once("error", onError);
      server.listen(socketPath, () => {
        server.off("error", onError);
        resolveListen();
      });
    });
    await chmod(socketPath, 0o600);
    const identity = await exactPrivateSocket(socketPath);
    let closePromise: Promise<void> | null = null;
    return Object.freeze({
      socketPath,
      close(): Promise<void> {
        closePromise ??= (async () => {
          closing = true;
          if (!handlerStarted) activeSocket?.destroy();
          await closeIdentityBoundServer(server, socketPath, identity, activeHandler);
        })();
        return closePromise;
      },
    });
  } catch (error) {
    closing = true;
    await closeServer(server).catch(() => undefined);
    throw error;
  }
}

async function waitForSocketConnection(socket: Socket): Promise<void> {
  await new Promise<void>((resolveConnection, rejectConnection) => {
    const finish = (): void => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = (): void => {
      finish();
      resolveConnection();
    };
    const onError = (error: Error): void => {
      finish();
      rejectConnection(error);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function readAuthorizationResponse(socket: Socket): Promise<Buffer> {
  return new Promise<Buffer>((resolveResponse, rejectResponse) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const clear = (): void => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const eraseChunks = (): void => {
      for (const chunk of chunks) chunk.fill(0);
    };
    const reject = (error: Error): void => {
      if (settled) return;
      settled = true;
      clear();
      eraseChunks();
      rejectResponse(error);
    };
    const onData = (chunk: Buffer): void => {
      const bytes = Buffer.from(chunk);
      length += bytes.byteLength;
      if (length > RESPONSE_HEADER_BYTES + RESPONSE_MAXIMUM_BYTES) {
        bytes.fill(0);
        reject(new LifecycleError({
          code: "runtime.authorization-channel-response",
          message: "The authorization invocation response exceeds its bound",
          retryable: true,
        }));
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      clear();
      const response = Buffer.concat(chunks, length);
      eraseChunks();
      resolveResponse(response);
    };
    const onError = (error: Error): void => reject(error);
    const onClose = (): void => {
      reject(new Error("authorization invocation closed before its response completed"));
    };
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

/** Stream one bounded authority secret into the exact live local invocation. */
export async function sendFoundationInvocationPrivateAuthorizationV1(input: Readonly<{
  challenge: string;
  authoritySecret: Uint8Array;
  socketRoot?: string;
  signal?: AbortSignal;
}>): Promise<FoundationInvocationPrivateAuthorizationHandoffResultV1> {
  if (input.signal?.aborted) {
    fail("runtime.interrupted", "Lifecycle was interrupted before authorization started", true);
  }
  const available = await resolveInvocationPrivateAuthorizationAvailability(
    input.challenge,
    input.socketRoot,
  );
  const request = encodeRequest(available.challenge.token, input.authoritySecret);
  const socket = createConnection({ path: available.socketPath });
  // Keep an error observer installed for the entire socket lifetime. The
  // connection and response promises still propagate the failure, while this
  // observer closes the event-emitter gap between their scoped listeners.
  socket.on("error", () => undefined);
  const responseTask = readAuthorizationResponse(socket);
  void responseTask.catch(() => undefined);
  const abort = (): void => {
    socket.destroy(new Error("authorization interrupted"));
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  let submissionMayHaveStarted = false;
  try {
    await waitForSocketConnection(socket);
    const after = await exactPrivateSocket(available.socketPath);
    if (!sameSocketIdentity(available.socketIdentity, after)) {
      fail(
        "runtime.authorization-invocation-unavailable",
        "The selected authorization invocation changed during connection",
        true,
      );
    }
    if (input.signal?.aborted) {
      fail("runtime.interrupted", "Lifecycle was interrupted before authorization started", true);
    }
    submissionMayHaveStarted = true;
    socket.end(request);
    const response = await responseTask;
    try {
      return decodeResponse(response, available.challenge.invocationId);
    } finally {
      response.fill(0);
    }
  } catch (error) {
    if (submissionMayHaveStarted) {
      if (error instanceof LifecycleError && noHandlerRefusals.has(error)) throw error;
      throw observationUnavailable(available.challenge.invocationId);
    }
    if (input.signal?.aborted) {
      return fail("runtime.interrupted", "Lifecycle authorization was interrupted", true);
    }
    if (error instanceof LifecycleError) throw error;
    return fail(
      "runtime.authorization-invocation-unavailable",
      "The selected authorization invocation is unavailable",
      true,
    );
  } finally {
    input.signal?.removeEventListener("abort", abort);
    request.fill(0);
    socket.destroy();
  }
}
