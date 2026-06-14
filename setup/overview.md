# Setup

## Purpose

Use this folder for installing Lifecycle into a target codebase repository.

Setup material explains where installed methodology, installed discipline,
scratch material, product records, and Control records should live
in an application repo. It is not the active methodology itself.

Setup creates installed methodology and selected discipline for target
repo agents. The target repo agent reads installed methodology during normal
work, not Lifecycle model rationale.

## Pages

Use [target-codebase-layout.md](target-codebase-layout.md) for the target repo
storage shape.

Use [install-procedure.md](install-procedure.md) to install committed records
and local Lifecycle support in a target codebase.

Use [compile-install-workflow.md](compile-install-workflow.md) for the agent-led
workflow that creates installed methodology and selected discipline from
source packages. Use its helper command for deterministic installs and preserve
existing records unless the target is disposable. Use the helper's
start-new-process mode to reset only `records/control/` between committed
process runs while preserving semantic authority.

Use [tooling-install.md](tooling-install.md) when package-managed Lifecycle
tools and optional generated tooling support should be installed in a target
repo.

Use [record-overview-files.md](record-overview-files.md) to seed neutral
`overview.md` files.

Use [first-run.md](first-run.md) for the first invocation after install.

Use [verification.md](verification.md) to check the installed target repo.

## Target Codebase Shape

The installed target repo shape is:

```text
records/
  context/
  intent/
  assurance/
  blueprint/
  control/
    discovery/
      maps/
      plans/
      selections/
    delivery/
      work-boundaries/
      evidence/
      landings/
      releases/
      promotions/
      archives/
      closures/

.lifecycle/
  methodology/
    semantic-authority/
    disciplines/
  disciplines/
    catalog.md
    package-info/
    bindings/
    surfaces/
    cache/
    discipline.lock
  methodology.lock
  usage/    installed operating docs; tools/ covers the lt CLI
  scratch/
  tooling/  optional generated tooling support
```

`records/` is committed project material. `.lifecycle/` is local Lifecycle
support and should be gitignored in target repos.

Installed methodology includes start, route, state, Control record contract,
semantic authority, discipline guidance, check, response, and registry
pages so the agent can operate Lifecycle without reconstructing missing
process.

Installed discipline includes package info, generated surface content,
bindings, a catalog, cache space, and lock metadata. When a selected package
shapes a run, the active Control record must record the used material and
effect because `.lifecycle/` is ignored local support.

Optional tooling support lives under `.lifecycle/tooling/` when enabled. It is
derived local support for tools, not product authority or process state. Core
Lifecycle setup and manual Lifecycle operation do not require it.

Description semantic authority files live beside the source files they
describe. They use a leading `_` and the suffix `.desc.md`.
