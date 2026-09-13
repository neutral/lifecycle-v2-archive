import { assertFoundationAuthorityCredential, type FoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { chmod, lstat, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import {
  foundationInvocationPrivateAuthorizationSocketPathV1,
  parseFoundationInvocationPrivateAuthorizationChallengeV1,
  preflightFoundationInvocationPrivateAuthorizationV1,
  sendFoundationInvocationPrivateAuthorizationV1,
  startFoundationInvocationPrivateAuthorizationChannelServerV1,
  isFoundationInvocationPrivateAuthorizationObservationUnavailableV1,
  type FoundationInvocationPrivateAuthorizationHandoffResultV1,
} from "../../src/foundation/invocation-private-authorization-channel-v1.js";
import { LifecycleError } from "../../src/errors.js";

const INVOCATION_ID = "a1111111-1111-4111-8111-111111111111";
const OTHER_INVOCATION_ID = "b2222222-2222-4222-8222-222222222222";
const CHALLENGE = `lcw1.${INVOCATION_ID}.${"A".repeat(43)}`;
const OTHER_CHALLENGE = `lcw1.${OTHER_INVOCATION_ID}.${"B".repeat(43)}`;
const SECRET_TEXT = "invocation-private-director-secret-with-sufficient-entropy";
const SECRET = Buffer.from(SECRET_TEXT, "utf8");

function result(
  status: FoundationInvocationPrivateAuthorizationHandoffResultV1["status"] = "completed",
): FoundationInvocationPrivateAuthorizationHandoffResultV1 {
  return Object.freeze({
    kind: "invocation-private-authorization-result",
    invocationId: INVOCATION_ID,
    operation: "delivery.accept",
    deliveryId: "delivery:one",
    status,
    resultDigest: `sha256:${"1".repeat(64)}`,
  });
}

async function shortRoot(label: string): Promise<string> {
  const parent = process.platform === "darwin" ? "/private/tmp" : "/tmp";
  return await mkdtemp(join(parent, `lcw-channel-${label}-`));
}

function lifecycleCode(error: unknown): string | undefined {
  return error instanceof LifecycleError ? error.code : undefined;
}

function assertUnknownObservation(error: unknown): boolean {
  assert(isFoundationInvocationPrivateAuthorizationObservationUnavailableV1(error));
  assert.equal(error.code, "runtime.authorization-result-unavailable");
  assert.equal(error.repositoryChanged, null);
  assert.equal(error.operationalStateChanged, null);
  assert.equal(error.retryable, false);
  assert.deepEqual(error.recoveryActions, []);
  assert.deepEqual(error.observedFacts, { invocationId: INVOCATION_ID, authorizationSubmission: "may-have-started" });
  assert.doesNotMatch(JSON.stringify(error.toJSON()), /director-secret|fixture-private|signature|credential|lcw1\./u);
  return true;
}

async function rawExchange(socketPath: string, frame: Buffer): Promise<Buffer> {
  const socket = createConnection({ path: socketPath });
  await new Promise<void>((resolveConnect, rejectConnect) => {
    socket.once("connect", resolveConnect);
    socket.once("error", rejectConnect);
  });
  socket.end(frame);
  const chunks: Buffer[] = [];
  for await (const chunk of socket) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function framedRequest(options: Readonly<{
  magic?: string;
  challenge?: string;
  secret?: Buffer;
  declaredTokenLength?: number;
  declaredSecretLength?: number;
  suffix?: Buffer;
}> = {}): Buffer {
  const challenge = Buffer.from(options.challenge ?? CHALLENGE, "ascii");
  const secret = options.secret ?? SECRET;
  const suffix = options.suffix ?? Buffer.alloc(0);
  const frame = Buffer.alloc(8 + challenge.byteLength + secret.byteLength + suffix.byteLength);
  Buffer.from(options.magic ?? "LCW1", "ascii").copy(frame, 0);
  frame.writeUInt16BE(options.declaredTokenLength ?? challenge.byteLength, 4);
  frame.writeUInt16BE(options.declaredSecretLength ?? secret.byteLength, 6);
  challenge.copy(frame, 8);
  secret.copy(frame, 8 + challenge.byteLength);
  suffix.copy(frame, 8 + challenge.byteLength + secret.byteLength);
  return frame;
}

test("challenge parser accepts only the exact bounded shell-safe form", () => {
  assert.deepEqual(parseFoundationInvocationPrivateAuthorizationChallengeV1(CHALLENGE), {
    token: CHALLENGE,
    invocationId: INVOCATION_ID,
  });
  const malformed = [
    "",
    `lcw0.${INVOCATION_ID}.${"A".repeat(43)}`,
    `lcw1.${INVOCATION_ID.toUpperCase()}.${"A".repeat(43)}`,
    `lcw1.${INVOCATION_ID}.${"A".repeat(42)}`,
    `lcw1.${INVOCATION_ID}.${"A".repeat(44)}`,
    `lcw1.${INVOCATION_ID}.${"+".repeat(43)}`,
    `${CHALLENGE}\n`,
    ` ${CHALLENGE}`,
    `${CHALLENGE}.extra`,
    "x".repeat(97),
  ];
  for (const candidate of malformed) {
    assert.equal(parseFoundationInvocationPrivateAuthorizationChallengeV1(candidate), null, candidate);
  }
});

test("preflight refuses an owner-private stale socket left by a dead invocation", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const root = await shortRoot("stale");
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const socketPath = foundationInvocationPrivateAuthorizationSocketPathV1(INVOCATION_ID, root);
  const childSource = [
    'const { chmodSync } = require("node:fs");',
    'const { createServer } = require("node:net");',
    `const path = ${JSON.stringify(socketPath)};`,
    'const server = createServer();',
    'server.listen(path, () => { chmodSync(path, 0o600); process.stdout.write("ready\\n"); });',
  ].join("\n");
  const child = spawn(process.execPath, ["-e", childSource], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  await new Promise<void>((resolveReady, rejectReady) => {
    child.once("error", rejectReady);
    child.once("exit", (code, signal) => {
      rejectReady(new Error(`stale-socket fixture exited before ready: ${code ?? signal}`));
    });
    child.stdout.once("data", () => resolveReady());
  });
  assert.equal((await lstat(socketPath)).isSocket(), true);
  child.kill("SIGKILL");
  await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  assert.equal((await lstat(socketPath)).isSocket(), true, "SIGKILL leaves the socket inode behind");

  await assert.rejects(
    preflightFoundationInvocationPrivateAuthorizationV1(CHALLENGE, root),
    (error) => lifecycleCode(error) === "runtime.authorization-invocation-unavailable",
  );
});

test("owner-private channel transfers one bounded secret and returns only a bound safe result", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const root = await shortRoot("healthy");
  const observed: Array<{ challenge: string; authorityCredential: FoundationAuthorityCredential }> = [];
  const server = await startFoundationInvocationPrivateAuthorizationChannelServerV1({
    invocationId: INVOCATION_ID,
    socketRoot: root,
    async handle(request) {
      assertFoundationAuthorityCredential(request.authorityCredential, "director-decision");
      observed.push(request);
      return result();
    },
  });
  context.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.equal(statSync(server.socketPath).mode & 0o777, 0o600);
  assert.equal(statSync(server.socketPath).isSocket(), true);
  const response = await sendFoundationInvocationPrivateAuthorizationV1({
    challenge: CHALLENGE,
    authoritySecret: SECRET,
    socketRoot: root,
  });
  assert.deepEqual(response, result());
  assert.equal(observed.length, 1);
  assert.equal(observed[0]!.challenge, CHALLENGE);
  assert.deepEqual(Object.keys(observed[0]!.authorityCredential), []);
  assert.doesNotMatch(JSON.stringify(observed), /authoritySecret|director-secret/u);
  assert.throws(() => assertFoundationAuthorityCredential(observed[0]!.authorityCredential, "director-decision"), /live credential/u);
  assert.doesNotMatch(JSON.stringify(response), /director-secret/u);
  assert.equal("target" in response, false);

  await server.close();
  await assert.rejects(lstat(server.socketPath), /ENOENT/u);
});

test("peer loss between connection and response collection returns a structured failure", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const root = await shortRoot("peer-loss");
  const socketPath = foundationInvocationPrivateAuthorizationSocketPathV1(INVOCATION_ID, root);
  const peer = createServer((socket) => {
    socket.on("error", () => undefined);
    socket.destroy();
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    peer.once("error", rejectListen);
    peer.listen(socketPath, () => {
      peer.off("error", rejectListen);
      resolveListen();
    });
  });
  await chmod(socketPath, 0o600);
  context.after(async () => {
    if (peer.listening) {
      await new Promise<void>((resolveClose, rejectClose) => {
        peer.close((error) => error === undefined ? resolveClose() : rejectClose(error));
      });
    }
    await rm(root, { recursive: true, force: true });
  });

  await assert.rejects(
    sendFoundationInvocationPrivateAuthorizationV1({
      challenge: CHALLENGE,
      authoritySecret: SECRET,
      socketRoot: root,
    }),
    (error) => {
      assert.ok(error instanceof LifecycleError);
      assert.ok(
        error.code === "runtime.authorization-invocation-unavailable"
        || error.code === "runtime.authorization-result-unavailable",
      );
      if (error.code === "runtime.authorization-result-unavailable") assertUnknownObservation(error);
      return true;
    },
  );
});

test("malformed, oversized, extra, and wrong-invocation frames never reach the handler", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const root = await shortRoot("frames");
  let handled = 0;
  const server = await startFoundationInvocationPrivateAuthorizationChannelServerV1({
    invocationId: INVOCATION_ID,
    socketRoot: root,
    async handle() {
      handled += 1;
      return result();
    },
  });
  context.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  const cases = [
    framedRequest({ magic: "NOPE" }),
    framedRequest({ declaredTokenLength: 97 }),
    framedRequest({ declaredSecretLength: 4_097 }),
    framedRequest({ declaredSecretLength: 31, secret: Buffer.alloc(31, 0x61) }),
    framedRequest({ challenge: OTHER_CHALLENGE }),
    framedRequest({ secret: Buffer.concat([Buffer.alloc(32, 0x61), Buffer.from([0xff])]) }),
    framedRequest({ secret: Buffer.concat([Buffer.alloc(32, 0x61), Buffer.from([0])]) }),
    framedRequest({ suffix: Buffer.from([0x00]) }),
    Buffer.from("LCW1", "ascii"),
  ];
  for (const frame of cases) {
    const response = await rawExchange(server.socketPath, frame);
    assert.ok(response.byteLength <= 4_104);
    assert.doesNotMatch(response.toString("utf8"), /director-secret/u);
    assert.match(response.subarray(8).toString("utf8"), /authorization-refused/u);
    frame.fill(0);
    response.fill(0);
  }
  assert.equal(handled, 0);
});

test("a handler failure or invalid result cannot claim refusal or unchanged effects", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  for (const variant of ["before-effect", "after-effect", "invalid-result", "misbound-result"] as const) {
    const root = await shortRoot("unobserved");
    let handled = 0;
    let credential: FoundationAuthorityCredential | undefined;
    const effect = join(root, "fixture-effect");
    const server = await startFoundationInvocationPrivateAuthorizationChannelServerV1({
      invocationId: INVOCATION_ID, socketRoot: root,
      async handle(request) {
        handled += 1;
        credential = request.authorityCredential;
        if (variant !== "before-effect") await writeFile(effect, "retained effect\n", { mode: 0o600 });
        if (variant === "invalid-result") return { ...result(), signature: "fixture-private-signature" };
        if (variant === "misbound-result") return { ...result(), invocationId: OTHER_INVOCATION_ID };
        // A same-named untrusted error is not a no-handler refusal witness.
        throw new LifecycleError({ code: "runtime.authorization-refused", message: "fixture-private-message" });
      },
    });
    try {
      await assert.rejects(sendFoundationInvocationPrivateAuthorizationV1({
        challenge: CHALLENGE, authoritySecret: SECRET, socketRoot: root,
      }), assertUnknownObservation);
      await server.close();
      assert.equal(handled, 1, "the channel never redispatches a failed observation");
      if (variant === "before-effect") await assert.rejects(lstat(effect), /ENOENT/u);
      else assert.equal(await readFile(effect, "utf8"), "retained effect\n");
      assert.throws(() => assertFoundationAuthorityCredential(credential!, "director-decision"), /live credential/u);
    } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
  }
});

test("lost, malformed, substituted and oversized post-submission responses expose only unknown effects", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const frame = (value: unknown) => {
    const payload = Buffer.from(JSON.stringify(value));
    const bytes = Buffer.alloc(8 + payload.length);
    bytes.write("LCWR", 0, "ascii"); bytes.writeUInt32BE(payload.length, 4); payload.copy(bytes, 8);
    return bytes;
  };
  const unavailable = { kind: "invocation-private-authorization-observation-unavailable", invocationId: INVOCATION_ID, code: "authorization-result-unavailable" };
  const responses = [
    Buffer.alloc(0), Buffer.from("LCWR"), frame(result()).subarray(0, 20),
    Buffer.from("LCWR\0\0\0\x01{"), Buffer.alloc(4_105, 0x61),
    frame({ ...result(), invocationId: OTHER_INVOCATION_ID }),
    frame({ ...result(), extra: "fixture-private-response" }), frame(unavailable),
    frame({ ...unavailable, invocationId: OTHER_INVOCATION_ID }),
    frame({ ...unavailable, extra: "fixture-private-response" }),
  ];
  for (const response of responses) {
    const root = await shortRoot("response");
    const socketPath = foundationInvocationPrivateAuthorizationSocketPathV1(INVOCATION_ID, root);
    let submissions = 0;
    const peer = createServer({ allowHalfOpen: true }, socket => {
      socket.on("error", () => undefined);
      socket.on("data", chunk => { assert(Buffer.isBuffer(chunk)); chunk.fill(0); });
      socket.once("end", () => { submissions += 1; socket.end(response); });
    });
    await new Promise<void>(resolveListen => peer.listen(socketPath, resolveListen));
    await chmod(socketPath, 0o600);
    try {
      await assert.rejects(sendFoundationInvocationPrivateAuthorizationV1({
        challenge: CHALLENGE, authoritySecret: SECRET, socketRoot: root,
      }), assertUnknownObservation);
      assert.equal(submissions, 1);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => peer.close(error => error ? rejectClose(error) : resolveClose()));
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("one in-flight authorization excludes a concurrent consumer and close waits for settlement", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const root = await shortRoot("busy");
  let release!: () => void;
  const released = new Promise<void>((resolveRelease) => { release = resolveRelease; });
  let entered!: () => void;
  const didEnter = new Promise<void>((resolveEnter) => { entered = resolveEnter; });
  let handled = 0;
  const server = await startFoundationInvocationPrivateAuthorizationChannelServerV1({
    invocationId: INVOCATION_ID,
    socketRoot: root,
    async handle() {
      handled += 1;
      entered();
      await released;
      return result();
    },
  });
  context.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const first = sendFoundationInvocationPrivateAuthorizationV1({
    challenge: CHALLENGE,
    authoritySecret: SECRET,
    socketRoot: root,
  });
  await didEnter;
  await assert.rejects(
    sendFoundationInvocationPrivateAuthorizationV1({
      challenge: CHALLENGE,
      authoritySecret: SECRET,
      socketRoot: root,
    }),
    (error) => {
      assert(error instanceof LifecycleError);
      assert.equal(error.code, "runtime.authorization-refused");
      assert.equal(error.repositoryChanged, false);
      assert.equal(error.operationalStateChanged, false);
      return true;
    },
  );
  let closeSettled = false;
  const closing = server.close().then(() => { closeSettled = true; });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  assert.equal(closeSettled, false, "close cannot exit after claim and before durable opening settles");
  release();
  assert.deepEqual(await first, result());
  await closing;
  assert.equal(handled, 1);
  await assert.rejects(lstat(server.socketPath), /ENOENT/u);
});

test("abort leaves the submitted outcome unknown without allowing close to abandon an active handler", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const root = await shortRoot("abort");
  let release!: () => void;
  const released = new Promise<void>((resolveRelease) => { release = resolveRelease; });
  let entered!: () => void;
  const didEnter = new Promise<void>((resolveEnter) => { entered = resolveEnter; });
  const server = await startFoundationInvocationPrivateAuthorizationChannelServerV1({
    invocationId: INVOCATION_ID,
    socketRoot: root,
    async handle() {
      entered();
      await released;
      return result("recovery-required");
    },
  });
  context.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const controller = new AbortController();
  const sending = sendFoundationInvocationPrivateAuthorizationV1({
    challenge: CHALLENGE,
    authoritySecret: SECRET,
    socketRoot: root,
    signal: controller.signal,
  });
  await didEnter;
  controller.abort();
  await assert.rejects(sending, assertUnknownObservation);
  let closeSettled = false;
  const closing = server.close().then(() => { closeSettled = true; });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  assert.equal(closeSettled, false);
  release();
  await closing;

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(
    sendFoundationInvocationPrivateAuthorizationV1({
      challenge: CHALLENGE,
      authoritySecret: SECRET,
      socketRoot: root,
      signal: alreadyAborted.signal,
    }),
    (error) => {
      assert(error instanceof LifecycleError);
      assert.equal(error.code, "runtime.interrupted");
      assert.equal(error.repositoryChanged, false);
      assert.equal(error.operationalStateChanged, false);
      return true;
    },
  );
});

test("root and socket substitutions refuse without deleting the substituted object", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const permissiveRoot = await shortRoot("permissive");
  context.after(async () => await rm(permissiveRoot, { recursive: true, force: true }));
  await chmod(permissiveRoot, 0o755);
  await assert.rejects(
    startFoundationInvocationPrivateAuthorizationChannelServerV1({
      invocationId: INVOCATION_ID,
      socketRoot: permissiveRoot,
      async handle() { return result(); },
    }),
    (error) => lifecycleCode(error) === "runtime.authorization-channel-unavailable",
  );

  const occupiedRoot = await shortRoot("occupied");
  context.after(async () => await rm(occupiedRoot, { recursive: true, force: true }));
  const occupied = foundationInvocationPrivateAuthorizationSocketPathV1(INVOCATION_ID, occupiedRoot);
  await writeFile(occupied, "do-not-delete", { mode: 0o600 });
  await assert.rejects(
    startFoundationInvocationPrivateAuthorizationChannelServerV1({
      invocationId: INVOCATION_ID,
      socketRoot: occupiedRoot,
      async handle() { return result(); },
    }),
    (error) => lifecycleCode(error) === "runtime.authorization-channel-unavailable",
  );
  assert.equal((await lstat(occupied)).isFile(), true);

  const replacedRoot = await shortRoot("replaced");
  context.after(async () => await rm(replacedRoot, { recursive: true, force: true }));
  const server = await startFoundationInvocationPrivateAuthorizationChannelServerV1({
    invocationId: INVOCATION_ID,
    socketRoot: replacedRoot,
    async handle() { return result(); },
  });
  await unlink(server.socketPath);
  await writeFile(server.socketPath, "substituted", { mode: 0o600 });
  await assert.rejects(
    sendFoundationInvocationPrivateAuthorizationV1({
      challenge: CHALLENGE,
      authoritySecret: SECRET,
      socketRoot: replacedRoot,
    }),
    (error) => lifecycleCode(error) === "runtime.authorization-invocation-unavailable",
  );
  await assert.rejects(server.close());
  assert.equal(await (await lstat(server.socketPath)).isFile(), true);
});
