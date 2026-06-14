# Compile Install Workflow

## Purpose

Use this workflow to create installed methodology and selected discipline
in a target codebase.

Compile install is an agent-led workflow. The agent reads human-readable source
methodology, package manifests, the state model, discipline packages, and
an install profile, then writes installed target-local support for the target
repo. Helper scripts can generate or verify repeatable pieces, but the workflow
owns the installation.

## Source Inputs

Read these source files from the Lifecycle repo:

```text
methodology/package-manifest.md
methodology/states/state-model.md
methodology/processes/<selected-process>/package-manifest.md
methodology/semantic-authority/surfaces/package-manifest.md
methodology/disciplines/package-manifest.md
setup/install-profiles/core.md
```

Read one process manifest for each process listed in the selected install
profile. Read source pages referenced by those manifests only when the selected
install profile needs them. If the install profile lists additional discipline
package manifests, read those manifests as selected package inputs for that
profile.

## Target Outputs

Write these target-local outputs:

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
.lifecycle/disciplines/
  catalog.md
  package-info/
  bindings/
  surfaces/
  cache/
  discipline.lock
.lifecycle/methodology.lock
.lifecycle/scratch/overview.md
.lifecycle/work-traces/
.lifecycle/stop-work-requests/
.lifecycle/tooling/  optional generated tooling support when tools are enabled
records/
```

The target output is installed methodology, installed discipline, and
neutral record storage. It is not model rationale and does not contain product
meaning or process decisions.

Optional `.lifecycle/tooling/` output is generated tooling support. It is
derived local support for tools and is not required for core Lifecycle
operation.

## Run Location

For disposable sample output, run the helper from the Lifecycle repo root.

For a real target codebase, run the helper command from the target codebase
root and pass absolute paths to the Lifecycle checkout:

```sh
LIFECYCLE_ROOT=/path/to/lifecycle

node "$LIFECYCLE_ROOT/setup/compile-install-helper.mjs" \
  --profile "$LIFECYCLE_ROOT/setup/install-profiles/core.md" \
  --target "$(pwd)" \
  --clean
```

The helper has no package install step. It uses Node.js built-ins and reads the
Markdown manifests directly.

Use [tooling-install.md](tooling-install.md) when the target repo should also
install the package-managed CLI.

`--clean` refreshes local installed methodology and installed discipline.
It preserves committed `records/` content, local scratch material, and existing
`.gitignore` rules. Without `--with-tooling`, it removes `.lifecycle/tooling/`
so stale generated tooling support does not survive a core install. The helper
appends `.lifecycle/` to `.gitignore` when the line is missing.

Use `--start-new-process` after the prior process has been committed for
history and the next process should begin with only fresh process-local Control
records. It removes and recreates `records/control/` while preserving semantic
authority records under `records/context/`, `records/intent/`,
`records/assurance/`, `records/blueprint/`, and code-adjacent Description
files.

Use `--reset-records` only for disposable sample output or a target whose
committed records can be deleted and recreated.

## Workflow

1. Confirm the target codebase root.
2. Add `.lifecycle/` to the target repo `.gitignore`.
3. Read the selected install profile.
4. Read the selected package manifests, including additional discipline
   package manifests named by the profile.
5. Validate selected process ids, semantic authority surface ids, discipline
   package ids, discipline binding ids, state ids, semantic
   authority operations, semantic authority storage locators, Control record
   roots, package completeness, and source paths.
6. Generate installed state pages from `methodology/states/state-model.md`.
7. Copy selected start, route, local support, check, response, semantic
   authority operation, discipline operating guidance, Control record
   contract, and semantic authority surface pages.
8. Generate `semantic-authority/semantic-authority-surface-registry.yaml` from
   `methodology/semantic-authority/surfaces/package-manifest.md`.
9. Generate semantic authority entry templates from the selected surface
   manifest sections, including retrieval keys, target-reference guidance,
   adequacy checks, promotion candidates, body-section guidance, and seed
   examples.
10. Generate installed package info, surface content, and bindings for selected
    discipline packages under `.lifecycle/disciplines/`.
11. Generate `.lifecycle/disciplines/catalog.md` and
    `.lifecycle/disciplines/discipline.lock`.
12. Generate `registry.md` from the installed page set.
13. Create neutral `overview.md` files under target `records/`, including each
    selected Control record root.
14. Write `.lifecycle/methodology.lock`.
15. Run setup verification.

When tool assistance is enabled, generate or refresh `.lifecycle/tooling/`
from source-owned contracts and installed support metadata. Do not create
product records or Control records from generated tooling support.

Generated tooling support should include:

```text
support/contract-registry.json
support/check-registry.contract.json
support/tool-config.contract.json
support/tool-observations.contract.json
support/control-records/<process>/<record>.contract.json
tooling.lock.json
```

## Helper Script

Use the helper when a deterministic generation pass is enough:

```sh
node setup/compile-install-helper.mjs \
  --profile setup/install-profiles/core.md \
  --target sample-target \
  --clean \
  --reset-records
```

Add optional generated tooling support with:

```sh
node setup/compile-install-helper.mjs \
  --profile setup/install-profiles/core.md \
  --target sample-target \
  --clean \
  --reset-records \
  --with-tooling
```

The helper reads the same Markdown manifests and state model that the workflow
uses. An agent may still edit or regenerate installed methodology when the
target install profile requires judgment that the helper does not encode.
The same rule applies to selected discipline material.

Use this helper form to start a new process in an existing target without
deleting semantic authority:

```sh
node setup/compile-install-helper.mjs \
  --profile setup/install-profiles/core.md \
  --target sample-target \
  --clean \
  --start-new-process
```

Seed examples in generated templates are examples only. Setup does not create
product authority entries for a target repo because that would invent product
meaning during installation.

## Validation Rules

Block installation when:

```text
two selected packages define the same process id
two selected surfaces define the same semantic authority surface id
two selected discipline packages define the same package id
two selected discipline packages define the same surface content id
two selected discipline bindings define the same binding id
two selected Control record contracts claim the same record root
two selected semantic authority surfaces claim the same storage locator
a semantic authority storage locator collides with a Control record root
a selected process references a missing state
a selected process references a missing semantic authority operation
a selected process record references a missing source-owned contract
a selected surface has a missing backpressure target
a selected surface is missing retrieval keys, adequacy checks, or promotion
candidates
Context, Intent, or Description lacks a minimal seed example
a source path in a selected manifest is missing
a selected discipline package has no binding
a selected discipline binding is missing discipline sources
a selected discipline binding references unselected package surface content
a selected discipline package header disagrees with its manifest row
a selected discipline binding is missing selection triggers
a selected discipline binding references a missing retrieval slice
a generated state page lacks a transition check or stop condition
a generated Delivery install lacks product judgment fields for Work Boundary,
Evidence Packet, Landing Packet, or Closure Record
```

Do not repair these as target-local edits. Fix the Lifecycle source manifest,
state model, or source methodology page that owns the problem.

Use the verification helper after generation:

```sh
node setup/verify-installed-methodology.mjs --target sample-target
```

## Human Review

After generation, inspect:

```text
.lifecycle/methodology/start.md
.lifecycle/methodology/route.md
.lifecycle/methodology/states/work-boundary-active.md
.lifecycle/methodology/local-support/stop-work-request.md
.lifecycle/methodology/local-support/tooling-support.md
.lifecycle/methodology/semantic-authority/semantic-authority-surface-registry.yaml
.lifecycle/disciplines/catalog.md
.lifecycle/methodology/control-records/overview.md
.lifecycle/methodology/control-records/plan-map.md
.lifecycle/methodology/control-records/work-boundary.md
.lifecycle/methodology/control-records/evidence-packet.md
.lifecycle/methodology/control-records/landing-packet.md
.lifecycle/methodology/control-records/closure-record.md
.lifecycle/methodology/checks/before-build.md
.lifecycle/methodology/checks/before-closure.md
.lifecycle/methodology.lock
```

The install passes review when an agent can start from `start.md`, route to one
state page, retrieve selected semantic and discipline when material, state
product judgment before Build, and act without reading model rationale.

When the profile selects discipline packages, also inspect the generated
package info, generated surface content, generated bindings, catalog entries,
and lock entries named by `.lifecycle/disciplines/catalog.md`.
