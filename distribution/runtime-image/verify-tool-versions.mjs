#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const mode = process.argv[2];
if (mode !== "--build" && mode !== "--runtime") process.exit(64);

function version(value, label) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.exec(value);
  if (match === null) throw new TypeError(`${label} did not report one exact stable semantic version`);
  return Object.freeze(match.slice(1).map(BigInt));
}

function atLeast(observed, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (observed[index] > minimum[index]) return true;
    if (observed[index] < minimum[index]) return false;
  }
  return true;
}

function output(executable, arguments_, label) {
  const result = spawnSync(executable, arguments_, {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
    maxBuffer: 8_192,
    shell: false,
  });
  if (result.status !== 0 || result.signal !== null || result.stderr.length > 8_192) {
    throw new TypeError(`${label} is unavailable`);
  }
  return result.stdout.trim();
}

if (!atLeast(version(process.versions.node, "Node.js"), [24n, 14n, 0n])) {
  throw new TypeError("Runtime Image requires Node.js 24.14.0 or newer");
}
if (mode === "--runtime") {
  const gitOutput = output("/usr/bin/git", ["--version"], "Git");
  const gitMatch = /^git version ([^ \r\n\0]+)(?: [^\r\n\0]+)?$/u.exec(gitOutput);
  // The selected integration rule uses -X and three tree operands, supported
  // together since Git 2.45.0. Reject an unusable Image during assembly.
  if (gitOutput.length > 212 || gitMatch === null || !atLeast(version(gitMatch[1], "Git"), [2n, 45n, 0n])) {
    throw new TypeError("Runtime Image requires Git 2.45.0 or newer with explicit tree merge bases and strategy options");
  }
  const dockerOutput = output("/usr/bin/docker", ["--version"], "Docker CLI");
  const match = /^Docker version ([^,]+), build [^\r\n]+$/u.exec(dockerOutput);
  if (match === null || !atLeast(version(match[1], "Docker CLI"), [27n, 1n, 0n])) {
    throw new TypeError("Runtime Image requires Docker CLI 27.1.0 or newer");
  }
}
