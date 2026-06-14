# Repository Instructions

## Orientation

This repository is the published source distribution of Lifecycle, a
methodology and tooling system for solo founder-dev software work with agents.
Lifecycle turns ambiguous input into admitted, bounded, proven production
change in target codebases. Its invariant is: only admitted behavior can ship.

Two worlds meet here, and this repository is the distribution side. Lifecycle
is operated in your target codebase, not here: you install from this repo into
a target, and your agents then work from the installed methodology under the
target's `.lifecycle/` folder. No product work, records, or Work Boundaries
are ever created in this repository.

Use this map:

```text
methodology/    source methodology that compiles into installed target methodology
setup/          install procedure, compile workflow, target layout, verification
usage/          operating docs that travel with installs; usage/tools/ covers the lt CLI
```

The `lt` CLI itself is distributed through npm as `@neutral/lifecycle-tools`;
this repo carries its usage documentation, which also installs into every
target at `.lifecycle/usage/tools/`.

## Installing Into A Target

Start at [setup/install-procedure.md](setup/install-procedure.md), then
[setup/first-run.md](setup/first-run.md). The compile helper and the install
verifier are dependency-free Node scripts:

```sh
node setup/compile-install-helper.mjs --profile setup/install-profiles/core.md \
  --target /path/to/your/repo --clean
node setup/verify-installed-methodology.mjs --target /path/to/your/repo
```

For the optional CLI, install the package in your target repo and read
[usage/tools/overview.md](usage/tools/overview.md):

```sh
npm install --save-dev @neutral/lifecycle-tools
```

## Changing This Repository

Do not. Public pull requests are not accepted at this time — see
[CONTRIBUTING.md](CONTRIBUTING.md) for how to reach a maintainer with fixes,
findings, or questions.

If you must verify a local modification anyway, the shipped checks are:

```sh
node setup/compile-install-helper.mjs --profile setup/install-profiles/core.md \
  --target sample-target --clean --reset-records
node setup/verify-installed-methodology.mjs --target sample-target
```

`sample-target/` is gitignored and disposable.
