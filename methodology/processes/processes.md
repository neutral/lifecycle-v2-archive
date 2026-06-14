# Lifecycle Processes

## Purpose

Use this folder for the process side of Lifecycle.

Lifecycle has three operating processes:

```text
Clarity
Discovery
Delivery
```

Clarity builds and maintains Context authority. Discovery shapes and selects
work. Delivery weighs product judgment, admits, builds, proves, reconciles,
releases, and closes one selected Signal.

Control keeps process state coherent across invocations. Control is not a
fourth process. It defines the shared mechanics that Clarity, Discovery, and
Delivery use for durable process state.

## Methodology Structure

The process methodology is organized around repeated agent use:

```text
process-first
record-local
control-shared
```

Process-first means agents enter through the work they are doing. Clarity,
Discovery, and Delivery are the process entrypoints.

Record-local means each process owns the Control record pages it uses during
normal work. Clarity owns Clarity Boundaries, Source Inventories, Context
Review Packets, and Clarity Closure Records. Discovery owns plan maps, plan
items, and selection handoffs. Delivery owns Work Boundaries, Evidence Packets,
Landing Packets, release summaries, knowledge promotion decisions, archive
decisions, and closure records.

Control-shared means state meanings, retrieval rules, contracts, closure
rules, checks, and the universal template header live once as shared
mechanics. Those rules apply across Clarity, Discovery, and Delivery, but they
do not form another Lifecycle process.

## Lifecycle State Model

Lifecycle work follows a parent state model that routes each invocation into
Clarity, Discovery, Delivery, or closure.

```text
no active Lifecycle work
-> route by prompt and current records
-> Clarity active, Discovery active, or Delivery active
-> process-local state machine
-> Control records updated
-> product judgment recorded before Delivery Build
-> discipline usage recorded when a selected package shaped the run
-> semantic authority updated only after admission, reconciliation, or promotion
-> closed or left active with explicit state
```

The parent state model has these states.

### No Active Lifecycle Work

No active process is controlling the invocation. The agent reads the prompt and
current records to decide whether useful work is unclear or a concrete Signal
already exists.

### Route by Prompt and Current Records

The agent chooses the active process. Use Clarity when Context authority itself
needs focused work. Use Discovery when useful work is unclear, attention needs
refresh, or candidate work must be selected. Use Delivery when there is a
concrete Signal to admit, build, prove, reconcile, and close.

### Clarity Active

Clarity runs its own state machine in [clarity/process.md](clarity/process.md).
It may close with updated Context and recommendations without starting
Discovery or Delivery.

### Discovery Active

Discovery runs its own state machine in [discovery/process.md](discovery/process.md).
It may close without starting Delivery, or it may produce a selected Signal for
Delivery.

### Delivery Active

Delivery runs its own state machine in [delivery/process.md](delivery/process.md).
It can start from a founder-provided Signal, runtime-derived Signal, support
request, or Discovery-selected Signal.

### Control Records Updated

The active process creates and updates its process-local Control records.
Control records preserve process state, product judgment, obligations, proof,
handoff, learning, archive, and closure decisions. Shared control mechanics
live in [control/overview.md](control/overview.md).

### Discipline Applied

Discipline is applied only when an operational package is selected through
a binding. The active process records selected package, binding, used material,
treatment, product judgment effect, proof, conflicts, and promotion candidates
in the owning Control record.

### Semantic Authority Updated

Semantic authority changes only through the owning process rules. Clarity may
update Context inside its active Clarity Boundary. Delivery may update semantic
authority after admission and reconciliation. Runtime learning may update
semantic authority only through knowledge promotion.

### Closed or Left Active

Lifecycle returns to no active work only when the active process closes and no
open process state remains. If work remains active, blocked, deferred, or
landing-ready, the relevant Control record must say so.

## Process Entry

Use [invocation.md](invocation.md) at the start of every agent invocation. It
tells the agent how to find active state, route to Clarity, Discovery, or
Delivery, load active context, resume work, and stop with explicit process
state.

Use [clarity/overview.md](clarity/overview.md) when Context itself needs
focused work.

Use [clarity/process.md](clarity/process.md) when the agent needs the Clarity
state machine and execution path.

Use [discovery/overview.md](discovery/overview.md) when the next useful work is
unclear, the founder-dev asks what should happen next, or long-range product
attention needs refresh.

Use [discovery/process.md](discovery/process.md) when the agent needs the
Discovery state machine and execution path.

Use [delivery/overview.md](delivery/overview.md) when the founder-dev provides
a concrete Signal or Discovery selects a Signal.

Use [delivery/process.md](delivery/process.md) when the agent needs the
Delivery state machine and execution path from Signal to closure.

The current handoff is:

```text
Clarity
-> recommendations
-> founder-dev inspection

Discovery
-> selected Signal
-> Delivery
```

Clarity can close without starting Discovery or Delivery. The founder-dev
inspects recommendations and decides what process starts next.

Discovery can close without starting Delivery. Delivery can start without
Discovery history when the founder-dev provides a concrete Signal.

## Control Records

Each process owns the Control records it creates and updates while running.
Control records are not shared mutable state across processes. Discovery and
Delivery may reference prior process records for handoff, proof, audit,
supersession, or history, but a new process writes its own Control records.

After a process closes and its records are committed for history, the next
independent process should begin from fresh `records/control/` scaffolding.
Semantic authority, target artifacts, proof, and observation preserve
cross-process continuity; prior Control records remain available through commit
history rather than active current-HEAD process state.

Use [clarity/control-records/overview.md](clarity/control-records/overview.md)
for Clarity Control records.

Use [discovery/control-records/overview.md](discovery/control-records/overview.md)
for Discovery Control records.

Use [delivery/control-records/overview.md](delivery/control-records/overview.md)
for Delivery Control records.

Use [control/overview.md](control/overview.md) for shared control mechanics:
states, retrieval, contracts, closure, checks, and templates.

Agents should start from the process, then read the process-local Control
record page for the state they need. Shared control pages are reference pages
for mechanics that apply across all processes.

## Process Boundaries

Clarity may:

```text
bound a Context pass
inventory source material and current Context
create or update Context entries inside the active Clarity Boundary
organize Context atlas routes, areas, clusters, and relations
review Context content adequacy, freshness, and canonicalization
record promotion pressure toward Intent, Assurance, Blueprint, or Description
prove retrieval of the smallest sufficient Context slice
close with recommendations
```

Clarity may not admit product behavior, authorize Build, select the next Signal
automatically, start Discovery or Delivery automatically, or update narrower
semantic authority surfaces by default.

Discovery may:

```text
maintain possible-work state
refresh plan maps
classify blockers, dependencies, deferrals, rejections, and closures
select a Signal
produce a selection handoff
```

Discovery may not admit product behavior or authorize Build.

Delivery may:

```text
interpret a selected Signal
state the product judgment that admits behavior
admit scope into a Work Boundary
build inside the active Work Boundary
produce Evidence Packets and Landing Packets
release or hand off landed work
produce release, promotion, archive, and closure records
apply selected discipline through Work Boundary, Proof, and Closure
```

Delivery may not treat a selected Signal, runtime observation, product
judgment, or closed Control record as product authority without admission or
knowledge promotion.
Delivery may not treat discipline as product semantic authority without
promotion of a product-specific accepted statement.

## Repeated Agent Path

Use this order during normal work:

```text
1. Start from the invocation protocol.
2. Identify the active process.
3. Read that process definition.
4. Read the active phase or step page when a gate blocks.
5. Retrieve semantic authority through methodology/semantic-authority/surfaces/contract.md when
   product meaning governs the work.
6. Retrieve discipline through `.lifecycle/disciplines/catalog.md`
   when reusable practice judgment materially constrains the work.
7. In Clarity, confirm the active Clarity Boundary before Context edits.
8. In Delivery, state or validate product judgment in the active Work Boundary
   before Build.
9. Read the process-local Control record page for the state being used.
10. Read shared control mechanics only for state, retrieval, contract, closure,
   check, or template questions.
```

Use [../semantic-authority/surfaces/contract.md](../semantic-authority/surfaces/contract.md)
for the semantic authority retrieval step.

Use [../disciplines/use-discipline.md](../disciplines/use-discipline.md)
for the discipline retrieval and recording step.

This keeps process behavior, durable process state, and shared control rules in
separate but adjacent places.
