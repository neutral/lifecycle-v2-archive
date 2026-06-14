# Tooling Install

## Purpose

Use this page to install Lifecycle tooling and optional generated tooling
support in a target codebase.

Core Lifecycle setup does not require tools. Use this page only when the target
repo should run tool-assisted inspection, verification, proof receipt capture,
or prepared-material workflows.

Use [install-procedure.md](install-procedure.md) before this page when the
target repo does not yet have installed Lifecycle methodology. Use
[verification.md](verification.md) after this page to verify the target repo.

## Ownership

Tooling install has two parts:

```text
CLI invocation -> executable tool available to the target repo
generated tooling support -> target-local contracts and cache under .lifecycle/tooling/
```

The CLI may be package-managed by the target repo or invoked source-locally
from a Lifecycle checkout during hardening. Package-managed installation is the
normal path for a target repo that wants committed tool dependency management.
Source-local invocation is useful when a Lifecycle source checkout is available
and the target should not receive package-manager files.

Generated tooling support is derived local support. It is ignored with
`.lifecycle/` and is not product authority, process state, or proof by itself.
An agent must record interpreted tool output in the owning durable record when
the output shapes Delivery, Discovery, semantic authority, proof, landing, or
closure.

## Preconditions

Before installing tooling:

- confirm the target codebase root
- install or refresh core Lifecycle methodology
- confirm `.lifecycle/` is ignored by git
- confirm `records/` is committed project material
- confirm whether the CLI will be package-managed or source-local
- for package-managed use, confirm the target package manager can install the
  Lifecycle CLI package and the execution boundary allows package installation
- for source-local use, confirm the Lifecycle source checkout is available

The package target is:

```text
package: @neutral/lifecycle-tools
binary: lt
```

## Install The Package-Managed CLI

Install the CLI using the target repo's package manager. Keep the dependency and
lockfile treatment consistent with the target repo.

Examples:

```sh
npm install --save-dev @neutral/lifecycle-tools
pnpm add --save-dev @neutral/lifecycle-tools
yarn add --dev @neutral/lifecycle-tools
bun add --dev @neutral/lifecycle-tools
```

After install, verify that the target repo can invoke the binary:

```sh
lt status --target .
```

If the package manager requires an exec wrapper, use the target repo's normal
form:

```sh
npm exec lt -- status --target .
pnpm exec lt -- status --target .
yarn lt status --target .
bunx lt status --target .
```

## Use A Source-Local CLI

The package-managed install above is the distribution path. A development
checkout of the Lifecycle source can also run the CLI directly from its
tooling area without installing a package-manager dependency into the target;
that is a maintainer workflow. It changes nothing about authority: generated
support remains ignored local support either way.

## Generate Target Tooling Support

Generated tooling support lives under:

```text
.lifecycle/tooling/
```

When installing from a Lifecycle source checkout, generate tooling support with
the compile install helper:

```sh
LIFECYCLE_ROOT=/path/to/lifecycle

node "$LIFECYCLE_ROOT/setup/compile-install-helper.mjs" \
  --profile "$LIFECYCLE_ROOT/setup/install-profiles/core.md" \
  --target "$(pwd)" \
  --clean \
  --with-tooling
```

When using the package-managed CLI, refresh generated support from the target
repo:

```sh
lt support refresh --target .
```

Generated tooling support should include:

```text
.lifecycle/tooling/tooling.lock.json
.lifecycle/tooling/support/contract-registry.json
.lifecycle/tooling/support/check-registry.contract.json
.lifecycle/tooling/support/tool-config.contract.json
.lifecycle/tooling/support/tool-observations.contract.json
.lifecycle/tooling/support/control-records/
.lifecycle/tooling/support/control-records/clarity/
.lifecycle/tooling/cache/
.lifecycle/tooling/findings/
.lifecycle/tooling/receipts/
.lifecycle/tooling/prepared-material/
```

Package-managed `lt` builds include a derived copy of the source-owned
contracts. If `lt support refresh` reports that contracts are unavailable, use
a package build that includes the packaged contract bundle, run the refresh from
a Lifecycle source distribution, or regenerate support through the compile
install helper with `--with-tooling`.

## Configure The Target

Shared target configuration belongs at the target root:

```text
lifecycle.tools.json
```

Local machine or agent configuration belongs under ignored local support:

```text
.lifecycle/tooling/config.local.json
```

Create a starter shared config when the target repo wants committed tool
configuration:

```sh
lt config init --target . --write
```

Review the generated config before committing it. Commit only non-secret,
target-wide configuration such as proof command ids, check enablement, and
include or exclude patterns. Keep credentials, machine paths, and local runtime
settings in `.lifecycle/tooling/config.local.json` or another ignored local
location.

## Verify The Install

Check setup and support:

```sh
lt status --target .
lt doctor --target .
lt verify setup --target .
lt verify support --target .
lt verify config --target .
```

Check generated support directly:

```sh
test -f .lifecycle/tooling/tooling.lock.json
test -f .lifecycle/tooling/support/contract-registry.json
git check-ignore -q .lifecycle/tooling
```

From a Lifecycle source checkout, also run setup verification:

```sh
LIFECYCLE_ROOT=/path/to/lifecycle

node "$LIFECYCLE_ROOT/setup/verify-installed-methodology.mjs" --target "$(pwd)"
```

## Refresh And Remove

Refresh tooling support after the installed methodology, source contracts, or
tool package changes:

```sh
lt support refresh --target .
lt support status --target .
```

Remove generated tooling support without removing installed methodology,
records, or product authority:

```sh
lt support remove --target .
```

Removing generated tooling support deletes derived local support and cache
material only. It must not delete product records, Control records, installed
methodology, installed discipline, proof already recorded in Evidence
Packets, or semantic authority entries.

## Failure Routing

If the CLI is unavailable, install or repair the package-managed dependency.

If generated tooling support is missing or stale, refresh support. Missing
tooling support blocks only the tool-backed check that depends on it. Manual
Lifecycle operation remains valid.

If config validation fails, fix shared config or move local-only values into
ignored local config.

If tool findings affect current work, interpret the finding and update the
owning Clarity Boundary, Context Review Packet, Work Boundary, Evidence Packet,
Landing Packet, closure record, Discovery record, or semantic authority entry
as appropriate. Do not treat raw tool output as durable authority.
