# Install procedure

## Purpose

Use this page to install Lifecycle support in a target codebase.

Use [target-codebase-layout.md](target-codebase-layout.md) for the storage
shape. Use [record-overview-files.md](record-overview-files.md) for neutral
overview contents after folders are created.

## Procedure

Run these steps from the target codebase root unless a step says to use the Git
repo root or the Lifecycle repo root.

### 1. Confirm The Target Codebase Root

The target codebase root is the directory that owns the application or package
being developed. In a single-application repo, this is usually the Git repo
root. In a monorepo, this can be a package or application subdirectory while
the `.git` entry lives at an ancestor.

Put `records/` and `.lifecycle/` in the target codebase root. Apply
repository-level Git checks and `.gitignore` changes from the Git repo root.

### 2. Create Committed Record Folders

Create every folder shown in [target-codebase-layout.md](target-codebase-layout.md).
Use `overview.md` for every folder overview. Do not create subfolder
`README.md` or `index.md` files.

If you use the compile install helper in step 5, the helper creates missing
record folders and missing neutral overview files. It preserves existing
records and existing overview files unless the command includes
`--reset-records`.

For a new Lifecycle process in an existing target, preserve semantic authority
records and reset only `records/control/` after the prior process has been
committed for history. Do not use `--reset-records` for that workflow because
it deletes the full `records/` root, including semantic authority entries.

If the target codebase already has a `records/` folder, preserve existing
records and create only missing folders or overview files.

A fresh install can use:

```sh
mkdir -p \
  records/context \
  records/intent \
  records/assurance \
  records/blueprint \
  records/control/clarity/boundaries \
  records/control/clarity/inventories \
  records/control/clarity/reviews \
  records/control/clarity/closures \
  records/control/discovery/maps \
  records/control/discovery/plans \
  records/control/discovery/selections \
  records/control/delivery/work-boundaries \
  records/control/delivery/evidence \
  records/control/delivery/landings \
  records/control/delivery/releases \
  records/control/delivery/promotions \
  records/control/delivery/archives \
  records/control/delivery/closures

find records -type d -exec sh -c \
  'test -f "$1/overview.md" || : > "$1/overview.md"' sh '{}' ';'
```

After creating the files, fill each `overview.md` with neutral folder purpose
text from [record-overview-files.md](record-overview-files.md).

Setup creates the root `records/context/` folder and a neutral overview. Do not
invent product-area Context subfolders during setup. Create Context atlas
subfolders, area overviews, canonical references, and rationale leaves later
only when current product Context needs those routes.

Do not create `records/description/`. Description semantic authority files live
beside the source files they describe. Use `_main.go.desc.md` for a
one-to-one Description of `main.go`; use an appropriate `_name.desc.md` for a
group Description.

### 3. Ignore Local Lifecycle Support

Add `.lifecycle/` to the Git repo `.gitignore` before copying methodology:

```text
.lifecycle/
```

Add the line only once. If `.gitignore` does not exist, create it at the Git
repo root. If you use the compile install helper in step 5, the helper appends
this line and preserves existing ignore rules.

An install can use:

```sh
touch .gitignore
grep -qxF '.lifecycle/' .gitignore || printf '%s\n' '.lifecycle/' >> .gitignore
```

Verify from the Git repo root before the first commit:

```sh
git check-ignore -q path/to/target/.lifecycle/ && echo ".lifecycle/ is ignored"
```

### 4. Create Local Lifecycle Support

Create local Lifecycle support when installing manually:

```sh
mkdir -p \
  .lifecycle/methodology \
  .lifecycle/usage/tools \
  .lifecycle/disciplines/package-info \
  .lifecycle/disciplines/bindings \
  .lifecycle/disciplines/surfaces \
  .lifecycle/disciplines/cache \
  .lifecycle/scratch \
  .lifecycle/work-traces \
  .lifecycle/stop-work-requests
```

`.lifecycle/methodology/` holds installed methodology for the target codebase.

`.lifecycle/usage/` holds installed operating docs that travel with the
methodology, one topic per subfolder. `.lifecycle/usage/tools/` is the first:
the `lt` usage docs — command surface, gate mapping, and inspection guide.
Treat them as read-only local support.

`.lifecycle/disciplines/` holds installed package info, generated surface
content, discipline bindings, the discipline catalog, cache, and
local lock metadata. It is ignored local support. Control records preserve any
discipline material that shaped a run.

Treat `.lifecycle/methodology/` as read-only during target work. If a run
exposes a methodology gap, record the gap in `.lifecycle/scratch/` or in the
owning Control record when the current run depends on it. Update the Lifecycle
source repo separately unless the user explicitly asks to update installed
methodology.

`.lifecycle/scratch/` holds temporary reasoning, rough notes, and local
working material that should not become committed product records or Control
records.

`.lifecycle/work-traces/` holds optional local action sequence evidence for
active runs.

`.lifecycle/stop-work-requests/` holds external interruption requests for
active runs.

Optional generated tooling support belongs under `.lifecycle/tooling/` when
tool assistance is enabled. Core Lifecycle setup does not require this folder.
If tooling support is present, treat it as derived local support. Findings,
receipts, indexes, and prepared material become durable only when the agent
records their interpreted effect in the owning durable record.

When generated tooling support is enabled, derive it from source-owned
contracts and include a tooling lock with source contract hashes and freshness
inputs.

Use [tooling-install.md](tooling-install.md) when the target repo should install
the package-managed CLI and generated tooling support.

### 5. Compile Installed Methodology And Discipline

Create installed methodology and selected discipline with
[compile-install-workflow.md](compile-install-workflow.md).

The target codebase agent reads installed methodology during normal work. The
model folder belongs to Lifecycle methodology development and does not belong in
installed methodology.

The installed target-local support shape is:

```text
.lifecycle/methodology/
  start.md
  route.md
  processes/
  states/
  control-records/
  local-support/
  semantic-authority/
  disciplines/
  checks/
  responses/
  registry.md
.lifecycle/usage/
  overview.md
  tools/
    overview.md
    commands.md
    agent-use.md
    inspect.md
.lifecycle/disciplines/
  catalog.md
  package-info/
  bindings/
  surfaces/
  cache/
  discipline.lock
.lifecycle/scratch/
.lifecycle/work-traces/
.lifecycle/stop-work-requests/
.lifecycle/tooling/  optional when tool assistance is enabled
```

The installed target-local support should include these operational entrypoints:

```text
.lifecycle/methodology/start.md
.lifecycle/methodology/route.md
.lifecycle/methodology/processes/invocation.md
.lifecycle/methodology/processes/clarity/process.md
.lifecycle/methodology/states/no-active-work.md
.lifecycle/methodology/states/clarity-active.md
.lifecycle/methodology/states/work-boundary-active.md
.lifecycle/methodology/control-records/overview.md
.lifecycle/methodology/control-records/clarity-boundary.md
.lifecycle/methodology/control-records/context-review-packet.md
.lifecycle/methodology/control-records/plan-map.md
.lifecycle/methodology/control-records/work-boundary.md
.lifecycle/methodology/local-support/work-trace.md
.lifecycle/methodology/local-support/stop-work-request.md
.lifecycle/methodology/local-support/tooling-support.md
.lifecycle/methodology/semantic-authority/semantic-authority-surface-registry.yaml
.lifecycle/methodology/semantic-authority/surfaces/contract.md
.lifecycle/methodology/semantic-authority/surfaces/update-procedure.md
.lifecycle/methodology/semantic-authority/update-product-meaning.md
.lifecycle/methodology/disciplines/package-contract.md
.lifecycle/methodology/disciplines/use-discipline.md
.lifecycle/disciplines/catalog.md
.lifecycle/disciplines/discipline.lock
.lifecycle/methodology/checks/before-closure.md
.lifecycle/methodology/responses/reframe.md
```

For the core install profile, an agent can use the helper from the target
codebase root:

```sh
LIFECYCLE_ROOT=/path/to/lifecycle

node "$LIFECYCLE_ROOT/setup/compile-install-helper.mjs" \
  --profile "$LIFECYCLE_ROOT/setup/install-profiles/core.md" \
  --target "$(pwd)" \
  --clean
```

The helper reads the same Markdown manifests and state model named by
[compile-install-workflow.md](compile-install-workflow.md). If a target install
requires judgment the helper does not encode, follow the workflow directly and
use the helper only for validation or regeneration.

`--clean` refreshes `.lifecycle/methodology/` and
`.lifecycle/disciplines/`. It does not delete committed `records/` or
local scratch material. Without `--with-tooling`, it removes
`.lifecycle/tooling/` so stale generated tooling support does not survive a
core install.

Use `--start-new-process` when the previous Lifecycle process has been
committed and the next process should start with a clean Control-record area:

```sh
node "$LIFECYCLE_ROOT/setup/compile-install-helper.mjs" \
  --profile "$LIFECYCLE_ROOT/setup/install-profiles/core.md" \
  --target "$(pwd)" \
  --clean \
  --start-new-process
```

This removes and recreates only `records/control/`. It preserves Context,
Intent, Assurance, Blueprint, and code-adjacent Description authority so
durable product meaning carries forward while process-local Control records
start fresh.

Use `--reset-records` only for a disposable sample target or a target whose
committed records can be deleted and recreated:

```sh
node "$LIFECYCLE_ROOT/setup/compile-install-helper.mjs" \
  --profile "$LIFECYCLE_ROOT/setup/install-profiles/core.md" \
  --target sample-target \
  --clean \
  --reset-records
```

### 6. Verify Neutral Overview Files

Do not invent product meaning, plans, Work Boundaries, evidence, or decisions
during setup. Create empty or neutral overview files that explain folder
purpose.

Substantive product records and Control records should appear only after an
owning process creates them through semantic authority update,
product-judgment-supported admission, Discovery, Delivery, proof, landing,
promotion, archive, or closure.
