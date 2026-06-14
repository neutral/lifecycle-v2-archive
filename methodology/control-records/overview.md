# Control Record Contracts

## Purpose

Use this installed methodology area for Control record contracts.

Control record contracts describe how target agents create and update process
state under `records/control/`. They are interfaces, not records.

Semantic authority authoring is not in this folder. Semantic authority entries
live under their owning semantic authority storage. Context, Intent, Assurance,
and Blueprint live under surface folders. Description files live beside source
files as `_*.desc.md`. Use `semantic-authority/` for their registry, surface
contracts, templates, retrieval, and update operations.

## Boundary

Installed methodology uses these homes:

```text
control-records/     Control record contracts for process state
local-support/       work trace, stop-work request, tooling support
semantic-authority/  semantic authority contracts and operations for product meaning
disciplines/    discipline operating guidance
checks/              transition and installed repo checks
responses/           failure and routing responses
states/              active state pages
```

Target records use these homes:

```text
records/control/  persisted Control records
records/<semantic authority surface>/  persisted Context, Intent, Assurance, and Blueprint entries
**/_*.desc.md  persisted Description entries beside described source files
```

Control records are process-local current state. Do not share mutable Control
records across independent processes. After a closed process has been
committed for history, start the next independent process from fresh
`records/control/` scaffolding and preserve semantic authority for durable
product continuity.

Do not store actual process state inside installed methodology. Do not store
product meaning inside installed methodology.

## Use

When a state page tells the agent to create or update a Control record, read
the relevant contract in this folder and write the actual record under the
target `records/control/` root named by the state page or contract.
