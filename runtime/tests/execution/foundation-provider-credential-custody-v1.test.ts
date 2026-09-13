import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { FoundationError } from "../../src/foundation/error.js";
import { openFoundationProviderCredentialCustodyV1 } from
  "../../src/foundation/execution/provider-credential-custody-v1.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";

const NOW = "2026-09-08T10:00:00.000Z";
const PRIVATE_ROOT = ".lifecycle-provider-credential-custody-v1";
const CUSTODY_MODULE = new URL("../../src/foundation/execution/provider-credential-custody-v1.js", import.meta.url).href;
const execFileAsync = promisify(execFile);
const INTERRUPTED_EXIT = 73;
type Custody = Awaited<ReturnType<typeof openFoundationProviderCredentialCustodyV1>>;
type Subject = Parameters<Custody["claim"]>[0];

function subject(label: string): Subject {
  return Object.freeze({
    specificationDigest: sha256Bytes(`credential-specification-${label}`),
    engineIdentityDigest: sha256Bytes("credential-selected-engine"),
    allocationName: `lifecycle-execution-${sha256Bytes(`credential-allocation-${label}`).slice("sha256:".length)}`,
  });
}

function authentication(generation: string): Uint8Array {
  // These are deliberately synthetic bytes. No installed credential is read.
  return Uint8Array.from(Buffer.from(JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: `synthetic-access-${generation}`,
      refresh_token: `synthetic-refresh-${generation}`,
    },
  }) + "\n"));
}

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-provider-custody-")));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const codexHome = join(root, "codex-home");
  await mkdir(codexHome, { mode: 0o700 });
  const authPath = join(codexHome, "auth.json");
  const initial = authentication("initial");
  await writeFile(authPath, initial, { mode: 0o600 });
  return Object.freeze({
    root,
    codexHome,
    authPath,
    initial,
    open: async () => await openFoundationProviderCredentialCustodyV1({ codexHome, now: () => NOW }),
  });
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(Uint8Array.from(chunk));
  return Uint8Array.from(Buffer.concat(chunks));
}

async function refuses(
  action: () => Promise<unknown>,
  suffix: string,
  reason: string,
  retryable?: boolean,
): Promise<void> {
  await assert.rejects(async () => await action(), (error: unknown) => {
    assert.ok(error instanceof FoundationError, reason);
    assert.equal(error.code, `lifecycle.execution.provider-credential-custody-v1.${suffix}`, reason);
    if (retryable !== undefined) assert.equal(error.retryable, retryable, reason);
    assert.doesNotMatch(JSON.stringify(error.toJSON()), /synthetic-(?:access|refresh)-/u);
    assert.doesNotMatch(JSON.stringify(error.toJSON()), /lifecycle-provider-custody-/u);
    return true;
  }, reason);
}

async function interruptedChild(input: Readonly<{
  codexHome: string;
  subject: Subject;
  boundary: "claim-retained" | "settlement-prepared" | "credential-replaced" | "settlement-retained";
}>): Promise<void> {
  await assert.rejects(execFileAsync(process.execPath, [
    "--input-type=module",
    "--eval",
    `const [moduleUrl, codexHome, exactSubject, now, cutoff] = process.argv.slice(1);
     const { openFoundationProviderCredentialCustodyV1 } = await import(moduleUrl);
     const custody = await openFoundationProviderCredentialCustodyV1({
       codexHome,
       now: () => now,
       onDurableBoundary: (boundary) => { if (boundary === cutoff) process.exit(73); },
     });
     const subject = JSON.parse(exactSubject);
     await custody.claim(subject);
     const bytes = Buffer.from(JSON.stringify({
       auth_mode: "chatgpt",
       tokens: {
         access_token: "synthetic-access-child-refresh",
         refresh_token: "synthetic-refresh-child-refresh",
       },
     }) + "\\n");
     await custody.settle(subject, { kind: "updated", bytes });`,
    CUSTODY_MODULE,
    input.codexHome,
    JSON.stringify(input.subject),
    NOW,
    input.boundary,
  ], { timeout: 10_000, maxBuffer: 64 * 1024 }), (error: unknown) => {
    assert.ok(error !== null && typeof error === "object");
    assert.equal("code" in error ? error.code : null, INTERRUPTED_EXIT,
      `child must terminate at the requested ${input.boundary} durable boundary`);
    assert.equal("stdout" in error ? error.stdout : null, "");
    assert.equal("stderr" in error ? error.stderr : null, "");
    return true;
  });
}

test("the exact execution claim survives reopening and excludes another execution until settlement", async (t) => {
  const selected = await fixture(t);
  const first = subject("first");
  const next = subject("next");
  const custody = await selected.open();
  assert.equal(await custody.hasClaim(first), false);
  await custody.claim(first);
  await custody.claim(first);
  assert.equal(await custody.hasClaim(first), true);
  assert.equal(await custody.hasClaim(next), false);

  const reopened = await selected.open();
  assert.equal(await reopened.hasClaim(first), true);
  await reopened.claim(first);
  await refuses(() => reopened.claim(next), "busy", "another execution cannot reuse an active refreshable session", true);
  assert.deepEqual(await collect((await reopened.read(first)).read()), selected.initial);
  assert.equal(await reopened.settlement(first), null);

  const receipt = await reopened.settle(first, { kind: "unused" });
  assert.equal(await reopened.hasClaim(first), false);
  assert.deepEqual(await (await selected.open()).settlement(first), receipt);
  await (await selected.open()).claim(next);
  assert.deepEqual(await collect((await custody.read(next)).read()), selected.initial);
  await custody.settle(next, { kind: "unused" });
});

test("process exit at claim retention leaves an exact recoverable claim on disk for a fresh process", async (t) => {
  const selected = await fixture(t);
  const exact = subject("exited-claimant");
  await interruptedChild({ codexHome: selected.codexHome, subject: exact, boundary: "claim-retained" });

  const recovered = await selected.open();
  await recovered.claim(exact);
  await refuses(() => recovered.claim(subject("other-process")), "busy", "process exit does not release an unsettled execution claim", true);
  assert.deepEqual(await collect((await recovered.read(exact)).read()), selected.initial);
  await recovered.settle(exact, { kind: "unused" });
  const next = subject("after-process-recovery");
  await recovered.claim(next);
  assert.deepEqual(await collect((await recovered.read(next)).read()), selected.initial);
  await recovered.settle(next, { kind: "unused" });
});

test("restarting at each durable refresh boundary completes the exact generation and rejects stale overwrite", async (t) => {
  for (const boundary of ["settlement-prepared", "credential-replaced", "settlement-retained"] as const) {
    await t.test(boundary, async (subtest) => {
      const selected = await fixture(subtest);
      const exact = subject(boundary);
      const refreshed = authentication("child-refresh");
      await interruptedChild({ codexHome: selected.codexHome, subject: exact, boundary });
      assert.deepEqual(Uint8Array.from(await readFile(selected.authPath)),
        boundary === "settlement-prepared" ? selected.initial : refreshed,
        "the observed auth file must agree with the named completed durable transition");

      const recovered = await selected.open();
      const receipt = await recovered.settle(exact, { kind: "updated", bytes: Uint8Array.from(refreshed) });
      assert.deepEqual(await recovered.settlement(exact), receipt);
      assert.deepEqual(Uint8Array.from(await readFile(selected.authPath)), refreshed);
      const next = subject(`${boundary}-next`);
      await recovered.claim(next);
      assert.deepEqual(await collect((await recovered.read(next)).read()), refreshed);
      const later = authentication(`${boundary}-later`);
      await recovered.settle(next, { kind: "updated", bytes: Uint8Array.from(later) });
      const reopened = await selected.open();
      assert.deepEqual(await reopened.settle(exact, { kind: "updated", bytes: Uint8Array.from(refreshed) }), receipt);
      assert.deepEqual(Uint8Array.from(await readFile(selected.authPath)), later,
        "recovering an older execution cannot restore its generation over a later settled refresh");
    });
  }
});

test("a claimed authentication reader transfers one snapshot once and clears its yielded buffer", async (t) => {
  const selected = await fixture(t);
  const exact = subject("single-read");
  const custody = await selected.open();
  await custody.claim(exact);
  const reader = await custody.read(exact);
  assert.equal(reader.byteLength, selected.initial.byteLength);
  const transferred: Uint8Array[] = [];
  const observed: Uint8Array[] = [];
  for await (const bytes of reader.read()) {
    transferred.push(bytes);
    observed.push(Uint8Array.from(bytes));
  }
  assert.deepEqual(Uint8Array.from(Buffer.concat(observed)), selected.initial);
  assert.ok(transferred.length > 0);
  for (const bytes of transferred) assert.ok(bytes.every((byte) => byte === 0));
  await refuses(() => collect(reader.read()), "reader-reused", "a consumed authentication reader cannot be reused", false);
  await custody.settle(exact, { kind: "unused" });
});

test("ending a credential transfer early still clears the owned yielded buffer", async (t) => {
  const selected = await fixture(t);
  const exact = subject("abandoned-read");
  const custody = await selected.open();
  await custody.claim(exact);
  const reader = await custody.read(exact);
  let transfer: Uint8Array | null = null;
  for await (const bytes of reader.read()) {
    transfer = bytes;
    assert.ok(bytes.some((byte) => byte !== 0));
    break;
  }
  assert.ok(transfer !== null);
  assert.ok(transfer.every((byte) => byte === 0));
  await refuses(() => collect(reader.read()), "reader-reused", "an interrupted authentication reader cannot be replayed", false);
  await custody.settle(exact, { kind: "unused" });
});

test("updated settlement commits the refreshed generation before another execution can claim it", async (t) => {
  const selected = await fixture(t);
  const first = subject("refresh");
  const next = subject("after-refresh");
  const refreshed = authentication("refreshed");
  const custody = await selected.open();
  await custody.claim(first);
  const transfer = Uint8Array.from(refreshed);
  const receipt = await custody.settle(first, { kind: "updated", bytes: transfer });
  assert.ok(transfer.every((byte) => byte === 0), "settlement consumes its supplied credential buffer");
  assert.deepEqual(Uint8Array.from(await readFile(selected.authPath)), refreshed);
  assert.doesNotMatch(JSON.stringify(receipt), /synthetic-(?:access|refresh)-/u);
  const reopened = await selected.open();
  assert.deepEqual(await reopened.settlement(first), receipt);
  await refuses(() => reopened.claim(first), "already-settled", "a settled execution cannot reacquire provider authentication", false);
  await reopened.claim(next);
  assert.deepEqual(await collect((await reopened.read(next)).read()), refreshed);
  await reopened.settle(next, { kind: "unused" });
  const stat = await lstat(selected.authPath);
  assert.equal(stat.mode & 0o077, 0);
  assert.equal(stat.nlink, 1);
});

test("unused settlement preserves the original generation and permits the next execution", async (t) => {
  const selected = await fixture(t);
  const first = subject("unused");
  const next = subject("after-unused");
  const custody = await selected.open();
  await custody.claim(first);
  const receipt = await custody.settle(first, { kind: "unused" });
  assert.deepEqual(await custody.settle(first, { kind: "unused" }), receipt);
  assert.deepEqual(Uint8Array.from(await readFile(selected.authPath)), selected.initial);
  await custody.claim(next);
  assert.deepEqual(await collect((await custody.read(next)).read()), selected.initial);
  await custody.settle(next, { kind: "unused" });
});

test("conclusive credential loss releases the execution but requires different provisioned bytes before reuse", async (t) => {
  const selected = await fixture(t);
  const first = subject("lost");
  const next = subject("reprovisioned");
  const custody = await selected.open();
  await custody.claim(first);
  const receipt = await custody.settle(first, { kind: "lost" });
  const reopened = await selected.open();
  assert.deepEqual(await reopened.settlement(first), receipt);
  await refuses(() => reopened.claim(next), "reprovision-required", "the lost original authentication must not be reused", true);
  await writeFile(selected.authPath, selected.initial, { mode: 0o600 });
  await refuses(() => reopened.claim(next), "reprovision-required", "rewriting identical bytes is not fresh provisioning", true);

  const provisioned = authentication("reprovisioned");
  await writeFile(selected.authPath, provisioned, { mode: 0o600 });
  await (await selected.open()).claim(next);
  assert.deepEqual(await collect((await reopened.read(next)).read()), provisioned);
  await reopened.settle(next, { kind: "unused" });
});

test("live authentication replacement cannot be overwritten by a settling execution and restoring its basis permits settlement", async (t) => {
  const selected = await fixture(t);
  const exact = subject("compare-and-swap");
  const custody = await selected.open();
  await custody.claim(exact);
  const waitingReader = await custody.read(exact);
  const externallyProvisioned = authentication("outside-claim");
  await writeFile(selected.authPath, externallyProvisioned, { mode: 0o600 });
  const reopened = await selected.open();
  await refuses(() => reopened.read(exact), "changed-auth",
    "known replaced custody cannot issue provider authentication", true);
  await refuses(() => collect(waitingReader.read()), "changed-auth",
    "a reader created earlier must recheck custody before transferring authentication", true);
  const refreshed = authentication("after-restoration");
  const transfer = Uint8Array.from(refreshed);
  await refuses(
    () => reopened.settle(exact, { kind: "updated", bytes: transfer }),
    "changed-auth",
    "settlement cannot replace another provisioned generation",
    true,
  );
  assert.ok(transfer.every((byte) => byte === 0));
  assert.equal(await reopened.settlement(exact), null);
  assert.deepEqual(Uint8Array.from(await readFile(selected.authPath)), externallyProvisioned);
  await refuses(() => reopened.claim(subject("while-cas-unresolved")), "busy", "failed settlement retains the original claim", true);

  await writeFile(selected.authPath, selected.initial, { mode: 0o600 });
  assert.deepEqual(await collect((await reopened.read(exact)).read()), selected.initial,
    "restored custody reopens the retained original generation");
  await (await selected.open()).settle(exact, { kind: "updated", bytes: Uint8Array.from(refreshed) });
  assert.deepEqual(Uint8Array.from(await readFile(selected.authPath)), refreshed);
});

test("an interrupted prepared refresh retains its original comparison basis through outside auth changes and restoration", async (t) => {
  const selected = await fixture(t);
  const exact = subject("prepared-refresh-cas");
  await interruptedChild({ codexHome: selected.codexHome, subject: exact, boundary: "settlement-prepared" });
  const other = authentication("outside-prepared-refresh");
  await writeFile(selected.authPath, other, { mode: 0o600 });
  const recovered = await selected.open();
  await refuses(() => recovered.settle(exact, { kind: "updated", bytes: authentication("child-refresh") }),
    "changed-auth", "recovery must not select changed live authentication as its replacement basis", true);
  assert.equal(await recovered.hasClaim(exact), true);
  assert.deepEqual(Uint8Array.from(await readFile(selected.authPath)), other);
  await writeFile(selected.authPath, selected.initial, { mode: 0o600 });
  await (await selected.open()).settle(exact, { kind: "updated", bytes: authentication("child-refresh") });
  const next = subject("after-prepared-refresh-cas");
  await recovered.claim(next);
  assert.deepEqual(await collect((await recovered.read(next)).read()), authentication("child-refresh"));
  await recovered.settle(next, { kind: "unused" });
});

test("temporary loss of the exact claimed snapshot retains the claim and restoration permits its original transfer", async (t) => {
  const selected = await fixture(t);
  const exact = subject("missing-original");
  const custody = await selected.open();
  await custody.claim(exact);
  const original = join(selected.codexHome, PRIVATE_ROOT, "original.auth");
  const unavailable = join(selected.root, "temporarily-unavailable-original");
  await rename(original, unavailable);
  const recovered = await selected.open();
  await refuses(() => recovered.read(exact), "unavailable", "missing exact custody cannot be replaced by live auth bytes", true);
  assert.equal(await recovered.hasClaim(exact), true);
  await refuses(() => recovered.claim(subject("while-original-missing")), "busy", "temporary snapshot loss does not release the claimed session", true);
  await rename(unavailable, original);
  const restored = await selected.open();
  assert.deepEqual(await collect((await restored.read(exact)).read()), selected.initial);
  await recovered.settle(exact, { kind: "unused" });
  const next = subject("after-original-restoration");
  await recovered.claim(next);
  await recovered.settle(next, { kind: "unused" });
});

test("temporary loss of a prepared refresh refuses regeneration and restored exact bytes complete settlement", async (t) => {
  const selected = await fixture(t);
  const exact = subject("missing-prepared-refresh");
  await interruptedChild({ codexHome: selected.codexHome, subject: exact, boundary: "settlement-prepared" });
  const pending = join(selected.codexHome, PRIVATE_ROOT, "pending.auth");
  const unavailable = join(selected.root, "temporarily-unavailable-refresh");
  await rename(pending, unavailable);
  const recovered = await selected.open();
  await refuses(() => recovered.settle(exact, { kind: "updated", bytes: authentication("child-refresh") }),
    "unavailable", "a retry cannot regenerate missing prepared custody from supplied bytes", true);
  assert.equal(await recovered.hasClaim(exact), true);
  assert.deepEqual(Uint8Array.from(await readFile(selected.authPath)), selected.initial);
  await rename(unavailable, pending);
  const receipt = await (await selected.open()).settle(exact, { kind: "updated", bytes: authentication("child-refresh") });
  assert.deepEqual(await recovered.settlement(exact), receipt);
  const next = subject("after-prepared-restoration");
  await recovered.claim(next);
  assert.deepEqual(await collect((await recovered.read(next)).read()), authentication("child-refresh"));
  await recovered.settle(next, { kind: "unused" });
});

test("retrying an old settlement receipt cannot overwrite a later execution's refreshed generation", async (t) => {
  const selected = await fixture(t);
  const first = subject("older-receipt");
  const second = subject("newer-receipt");
  const third = subject("current-receipt");
  const custody = await selected.open();
  await custody.claim(first);
  const receipt = await custody.settle(first, { kind: "updated", bytes: authentication("first-refresh") });
  await custody.claim(second);
  const latest = authentication("latest-refresh");
  await custody.settle(second, { kind: "updated", bytes: Uint8Array.from(latest) });
  const reopened = await selected.open();
  const substituted = authentication("stale-retry");
  await refuses(() => reopened.settle(first, { kind: "updated", bytes: substituted }), "settlement-substitution",
    "a retry cannot substitute bytes for the original settled refresh", false);
  assert.ok(substituted.every((byte) => byte === 0));
  for (const kind of ["unused", "lost"] as const) {
    await refuses(() => reopened.settle(first, { kind }), "settlement-substitution",
      "a retry cannot substitute another settlement disposition", false);
  }
  assert.deepEqual(await reopened.settle(first, { kind: "updated", bytes: authentication("first-refresh") }), receipt);
  assert.deepEqual(Uint8Array.from(await readFile(selected.authPath)), latest);
  await reopened.claim(third);
  assert.deepEqual(await collect((await reopened.read(third)).read()), latest);
  await reopened.settle(third, { kind: "unused" });
});

test("each execution subject coordinate independently prevents credential access or settlement substitution", async (t) => {
  const selected = await fixture(t);
  const exact = subject("bound-subject");
  const substitutions: readonly [string, Subject][] = [
    ["Specification", { ...exact, specificationDigest: sha256Bytes("another-specification") }],
    ["Engine", { ...exact, engineIdentityDigest: sha256Bytes("another-engine") }],
    ["allocation", { ...exact, allocationName: subject("another-allocation").allocationName }],
  ];
  const custody = await selected.open();
  await custody.claim(exact);
  await refuses(() => custody.forgetSettlement(exact), "claim-required",
    "a claim cannot be forgotten before exact terminal settlement", false);
  for (const [coordinate, substituted] of substitutions) {
    await refuses(() => custody.claim(substituted), "busy", `${coordinate} substitution cannot share the claim`, true);
    await refuses(() => custody.read(substituted), "claim-required", `${coordinate} substitution cannot retrieve authentication`, false);
    await refuses(() => custody.settle(substituted, { kind: "unused" }), "claim-required", `${coordinate} substitution cannot release the claim`, false);
    assert.equal(await custody.settlement(substituted), null);
  }
  assert.deepEqual(await collect((await custody.read(exact)).read()), selected.initial);
  const staleReader = await custody.read(exact);
  const receipt = await custody.settle(exact, { kind: "unused" });
  await custody.forgetSettlement(substitutions[0]![1]);
  assert.deepEqual(await custody.settlement(exact), receipt);
  await custody.forgetSettlement(exact);
  await custody.forgetSettlement(exact);
  assert.equal(await (await selected.open()).settlement(exact), null);
  await custody.claim(exact);
  await refuses(() => collect(staleReader.read()), "claim-required",
    "even equal auth bytes and the same execution subject cannot reuse a reader from a forgotten generation", false);
  assert.deepEqual(await collect((await custody.read(exact)).read()), selected.initial);
  await custody.settle(exact, { kind: "unused" });
});

test("malformed execution coordinates cannot create a credential claim", async (t) => {
  const selected = await fixture(t);
  const exact = subject("well-formed");
  const custody = await selected.open();
  const malformed: readonly Subject[] = [
    { ...exact, specificationDigest: `sha256:${"A".repeat(64)}` },
    { ...exact, engineIdentityDigest: "sha256:short" },
    { ...exact, allocationName: "../auth.json" },
  ];
  for (const input of malformed) {
    await refuses(() => custody.claim(input), "subject", "malformed coordinates cannot become custody identities", false);
  }
  await custody.claim(exact);
  assert.deepEqual(await collect((await custody.read(exact)).read()), selected.initial);
  await custody.settle(exact, { kind: "unused" });
});

test("on-disk authentication enforces the selected inclusive byte bounds and permits repaired provisioning", async (t) => {
  for (const byteLength of [1, 2, 4 * 1024 * 1024, 4 * 1024 * 1024 + 1]) {
    await t.test(`${byteLength} bytes`, async (subtest) => {
      const selected = await fixture(subtest);
      const exact = subject(`size-${byteLength}`);
      const bytes = Uint8Array.from(Buffer.alloc(byteLength, 0x61));
      await writeFile(selected.authPath, bytes, { mode: 0o600 });
      const custody = await selected.open();
      if (byteLength < 2 || byteLength > 4 * 1024 * 1024) {
        await refuses(() => custody.claim(exact), "private-path", "an out-of-bounds auth file cannot be snapshotted", false);
        await writeFile(selected.authPath, selected.initial, { mode: 0o600 });
      }
      await custody.claim(exact);
      assert.deepEqual(await collect((await custody.read(exact)).read()),
        byteLength < 2 || byteLength > 4 * 1024 * 1024 ? selected.initial : bytes);
      await custody.settle(exact, { kind: "unused" });
    });
  }
});

test("invalid refreshed byte bounds consume the transfer without releasing the claim and valid refresh can follow", async (t) => {
  for (const byteLength of [1, 4 * 1024 * 1024 + 1]) {
    await t.test(`${byteLength} bytes`, async (subtest) => {
      const selected = await fixture(subtest);
      const exact = subject(`invalid-update-${byteLength}`);
      const custody = await selected.open();
      await custody.claim(exact);
      const bytes = Uint8Array.from(Buffer.alloc(byteLength, 0x61));
      await refuses(() => custody.settle(exact, { kind: "updated", bytes }), "updated-bytes",
        "out-of-bounds refreshed bytes cannot become the installed generation", false);
      assert.ok(bytes.every((byte) => byte === 0));
      assert.equal(await custody.hasClaim(exact), true);
      assert.deepEqual(Uint8Array.from(await readFile(selected.authPath)), selected.initial);
      const refreshed = authentication("valid-after-size-refusal");
      await custody.settle(exact, { kind: "updated", bytes: Uint8Array.from(refreshed) });
      const next = subject(`after-size-refusal-${byteLength}`);
      await custody.claim(next);
      assert.deepEqual(await collect((await custody.read(next)).read()), refreshed);
      await custody.settle(next, { kind: "unused" });
    });
  }
});

test("private credential paths refuse unsafe custody and become usable after exact path repair", async (t) => {
  const cases = [
    "auth-symlink",
    "auth-hardlink",
    "auth-permissions",
    "home-symlink",
    "home-permissions",
    "custody-symlink",
    "custody-permissions",
  ] as const;
  for (const mutation of cases) await t.test(mutation, async (subtest) => {
    const selected = await fixture(subtest);
    const privateRoot = join(selected.codexHome, PRIVATE_ROOT);
    const other = join(selected.root, "other-private-path");
    let restore: () => Promise<void>;
    if (mutation === "auth-symlink") {
      await rename(selected.authPath, other);
      await symlink(other, selected.authPath);
      restore = async () => { await unlink(selected.authPath); await rename(other, selected.authPath); };
    } else if (mutation === "auth-hardlink") {
      await link(selected.authPath, other);
      restore = async () => { await unlink(other); };
    } else if (mutation === "auth-permissions") {
      await chmod(selected.authPath, 0o640);
      restore = async () => { await chmod(selected.authPath, 0o600); };
    } else if (mutation === "home-symlink") {
      await rename(selected.codexHome, other);
      await symlink(other, selected.codexHome);
      restore = async () => { await unlink(selected.codexHome); await rename(other, selected.codexHome); };
    } else if (mutation === "home-permissions") {
      await chmod(selected.codexHome, 0o770);
      restore = async () => { await chmod(selected.codexHome, 0o700); };
    } else if (mutation === "custody-symlink") {
      await mkdir(other, { mode: 0o700 });
      await symlink(other, privateRoot);
      restore = async () => { await unlink(privateRoot); await mkdir(privateRoot, { mode: 0o700 }); };
    } else {
      await mkdir(privateRoot, { mode: 0o700 });
      await chmod(privateRoot, 0o770);
      restore = async () => { await chmod(privateRoot, 0o700); };
    }
    const exact = subject(mutation);
    await refuses(async () => await (await selected.open()).claim(exact), "private-path", `${mutation} cannot supply credential custody`, false);
    await restore();
    const repaired = await selected.open();
    await repaired.claim(exact);
    assert.deepEqual(await collect((await repaired.read(exact)).read()), selected.initial);
    await repaired.settle(exact, { kind: "unused" });
  });
});
