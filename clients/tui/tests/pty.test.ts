import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  PtyCaptureLimitError,
  PtyTimeoutError,
  TestPtyHarness,
} from "./support/pty.js";

let harness: TestPtyHarness;

before(async () => {
  harness = await TestPtyHarness.create();
});

after(async () => {
  await harness?.dispose();
});

test("PTY harness writes keys, reports a real TTY, and applies resize with SIGWINCH", async () => {
  const source = String.raw`
if (!process.stdin.isTTY || !process.stdout.isTTY) process.exit(91);
process.stdin.setRawMode(true);
process.stdin.resume();
const size = (label) => process.stdout.write(label + " " + process.stdout.columns + "x" + process.stdout.rows + "\r\n");
process.on("SIGWINCH", () => size("RESIZE"));
process.stdin.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  if (text.includes("q")) process.exit(0);
  process.stdout.write("ECHO " + text + "\r\n");
});
size("READY");
`;
  const child = await harness.spawn(process.execPath, ["--input-type=module", "--eval", source], {
    viewport: { columns: 40, rows: 10 },
  });
  await child.waitForOutput("READY 40x10");
  await child.writeKeys("a");
  await child.waitForOutput("ECHO a");
  await child.resize(72, 20);
  await child.waitForOutput("RESIZE 72x20");
  await child.writeKeys("q");
  const result = await child.wait();
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.captureComplete, true);
  assert.match(result.text, /READY 40x10/u);
  assert.match(result.text, /RESIZE 72x20/u);
});

test("PTY harness forwards an explicit signal to the terminal process group", async () => {
  const source = String.raw`
process.on("SIGTERM", () => {
  process.stdout.write("OBSERVED SIGTERM\r\n");
  process.exit(23);
});
process.stdout.write("READY SIGNAL\r\n");
setInterval(() => {}, 1000);
`;
  const child = await harness.spawn(process.execPath, ["--input-type=module", "--eval", source]);
  await child.waitForOutput("READY SIGNAL");
  await child.signal("SIGTERM");
  const result = await child.wait();
  assert.equal(result.exitCode, 23);
  assert.equal(result.signal, null);
  assert.match(result.text, /OBSERVED SIGTERM/u);
});

test("PTY wait timeout terminates an interrupt-resistant child before rejecting", async () => {
  const source = String.raw`
process.on("SIGTERM", () => {});
process.stdout.write("READY TIMEOUT\r\n");
setInterval(() => {}, 1000);
`;
  const child = await harness.spawn(process.execPath, ["--input-type=module", "--eval", source]);
  await child.waitForOutput("READY TIMEOUT");
  await assert.rejects(
    child.wait(50),
    (error: unknown) => error instanceof PtyTimeoutError && error.code === "tui.test-pty.timeout",
  );
});

test("PTY capture is bounded and an overflow cannot be mistaken for complete output", async () => {
  const source = String.raw`
process.stdout.write("x".repeat(100000), () => process.exit(0));
`;
  const child = await harness.spawn(process.execPath, ["--input-type=module", "--eval", source], {
    maximumCaptureBytes: 1_024,
  });
  await assert.rejects(
    child.wait(),
    (error: unknown) => error instanceof PtyCaptureLimitError &&
      error.code === "tui.test-pty.capture-limit" &&
      error.output.byteLength === 1_024,
  );
});

test("harness disposal terminates live children, removes support, and is idempotent", async () => {
  const isolated = await TestPtyHarness.create();
  const child = await isolated.spawn(process.execPath, [
    "--input-type=module",
    "--eval",
    "process.stdout.write('READY DISPOSE\\r\\n'); setInterval(() => {}, 1000);",
  ]);
  await child.waitForOutput("READY DISPOSE");
  await isolated.dispose();
  await isolated.dispose();
  const result = await child.wait();
  assert.equal(result.exitCode === null || result.exitCode !== 0, true);
});
