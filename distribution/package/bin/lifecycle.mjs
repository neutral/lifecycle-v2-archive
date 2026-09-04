#!/usr/bin/env node

const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.exec(process.versions.node);
const observed = match === null ? null : match.slice(1).map(BigInt);
const minimum = [24n, 14n, 0n];
const sufficient = observed !== null && observed.every((value, index) =>
  value === minimum[index] || value > minimum[index] || observed.slice(0, index).some(
    (prior, priorIndex) => prior > minimum[priorIndex],
  ));
if (!sufficient) {
  process.stderr.write("Lifecycle requires Node.js 24.14.0 or newer.\n");
  process.exit(1);
}
const { runInstalledLauncher } = await import("../dist/src/main.js");
process.exitCode = await runInstalledLauncher("lifecycle", process.argv.slice(2));
