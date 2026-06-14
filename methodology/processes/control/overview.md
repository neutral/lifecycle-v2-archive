# Process Control

## Purpose

Use this folder for shared process control mechanics.

Clarity, Discovery, and Delivery are the processes. Control defines the shared
rules that make their durable process state current, retrievable, small, and
safe to use across invocations.

Control is not another process and not a product authority surface.

## Relationship To Process-Local Control Records

Process-local Control record pages live with the process that uses them:

```text
../discovery/control-records/
../delivery/control-records/
../clarity/control-records/
```

This folder defines the shared mechanics those records obey:

```text
placement
states
state mutations
retrieval
contracts
closure
checks
templates
```

Use process-local pages first. Use this folder when the agent needs a general
rule that applies across Clarity, Discovery, and Delivery.

## Pages

Use [placement.md](placement.md) to decide where Control records live and how
to name them.

Use [states.md](states.md) to decide what a Control record state means.

Use [state-mutations.md](state-mutations.md) when one Control record state
change requires another record to change in the same work pass.

Use [retrieval.md](retrieval.md) to decide which Control records enter active
context.

Use [contracts.md](contracts.md) for universal Control record contract
mechanics.

Use [closure.md](closure.md) to turn active process state into durable history
with clear pointers.

Use [checks.md](checks.md) to prevent vague, stale, or drifting Control
records.

Use [templates.md](templates.md) for the universal header and compact template
rule.

## Role Boundary

Control records sit beside semantic authority, target, proof, and observation.
They do not replace Context, Intent, Assurance, Blueprint, or Description as
current semantic authority.

Control records may contain product-relevant facts and active product judgment.
They may justify updates to semantic authority storage. They do not govern
future product judgment after the process closes unless the relevant meaning is
rewritten through semantic authority update or knowledge promotion.

Control records are process-local current state. Retain a closed process's
Control records in the commit that records that process, then start the next
independent process from fresh `records/control/` scaffolding. Do not share
mutable Control records across processes. Cross-process continuity belongs in
semantic authority, target artifacts, proof, observation, or explicit
references to historical commits.

The safety rule is:

```text
Do not let process history or closed product judgment become product truth
without admission or promotion.
```

Route durable residue by role:

```text
product meaning -> semantic authority -> semantic authority storage
process state -> Control records
verification -> proof
post-release facts -> observation
temporary reasoning -> working notes until distilled
```
