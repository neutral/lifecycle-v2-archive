# Closure Record

## Purpose

Use a closure record to preserve the end state of a Delivery run.

Closure turns active Delivery state into durable history with clear pointers.
It identifies what landed or was abandoned, what remains active, what learning
was promoted, what product judgment remains only historical process state, what
material was archived, and what should stay off by default.

## When To Use

Create a closure record before marking Delivery complete.

Delivery closure requires:

```text
landing or explicit abandonment resolved
product judgment satisfied, superseded, or abandoned
observation handling addressed when needed
knowledge promotion or archive decisions made
discipline usage recorded or explicitly not applicable
closure record produced
active Work Boundary closed
```

## Minimum Contents

A closure record preserves:

```text
record id
record state
closed Delivery run
outcome
landing or abandonment state
product judgment outcome
open, blocked, deferred, or superseded work
promoted learning pointers
discipline usage and promotion outcomes
archive decision pointers
records that remain active
records that are off by default
next retrieval pointer
```

## Lifecycle

Create a closure record when Delivery can close.

Update it while closure is being assembled and active, blocked, deferred,
superseded, archived, promoted, or off-by-default state is reconciled.

The closure record exits active state when the closed process or run has no
hidden active state and any remaining state is explicitly carried forward.

Validation check:

```text
obligations are resolved or carried forward
product judgment is not being treated as durable product authority after closure
discipline usage is resolved when it shaped the run
discipline promotion outcomes are resolved when present
```

Forbidden ownership:

```text
new product meaning that should live in semantic authority
proof details that should live in an Evidence Packet
landing handoff details that should live in a Landing Packet
```

## Template

```yaml
closure_record:
  id: ""
  state: "closed"
  closed_process_or_run: ""
  outcome: ""
  landing_or_abandonment_state: ""
  product_judgment_outcome: ""
  open_blocked_deferred_or_superseded_work: []
  promoted_learning: []
  discipline_outcomes: []
  archive_decisions: []
  records_remaining_active: []
  records_off_by_default: []
  next_retrieval_pointer: ""
```

## Closure Boundary

After Delivery closure, future agents should rely on current semantic
authority, target, proof, observation, and active Control records. Closed
Control records remain retrievable, but they do not enter active context by
default.

After the closed Delivery process has been committed for history, a later
independent process should start from fresh current `records/control/`
scaffolding. The closure record remains available through commit history; it
should not be carried as mutable current process state for the next run.

Closure must not hide discipline usage. If selected discipline
shaped the run, the closure record should point to the Control record that
contains `disciplines_used` and to any promotion, rejection, archive, or
deferral decision for discipline candidates.

Closure may carry separate Discovery roadmap state forward. If future work
remains possible but is not admitted in the closed Delivery run, name the
Discovery Plan Item in `open_blocked_deferred_or_superseded_work` or
`next_retrieval_pointer`. Do not list a separate Plan Item as hidden active
Delivery state in `records_remaining_active`; that field is for unresolved
state inside the closed run.

Prepared closure material from tooling is draft material. The agent owns the
closure outcome, carried-forward state, promotion and archive decisions, and
next retrieval pointer.
