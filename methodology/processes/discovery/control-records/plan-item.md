# Plan Item

## Purpose

Use a plan item to preserve one possible future work item.

A plan item keeps selection state current without turning future work into an
admitted requirement.

## When To Use

Create or update a plan item when Discovery needs to preserve:

```text
a possible Signal
why attention remains
a dependency
a blocker
a deferral
a rejection or closure reason
selection readiness
related semantic authority, target, proof, observation, or Control records
candidate discipline that may affect later admission
```

Close, defer, block, or supersede the plan item when that state changes.

When the founder-dev prompt asks the agent to pick, continue, sequence, or find
work and the possible Signal should survive the immediate response, create or
update the plan item before asking for selection or moving to Delivery.

## Minimum Contents

A plan item preserves:

```text
record id
record state
possible Signal
source basis
why attention remains
scope or product area
dependencies
blockers
selection status
close condition
related semantic authority, target, proof, observation, or Control records
candidate discipline packages and bindings when known
```

## Lifecycle

Create a plan item when possible work should survive the current thought.

Update it when attention, blocker, dependency, deferral, selection, rejection,
closure, or supersession state changes.
Update candidate discipline when Discovery learns that later admission
will need a domain constraint, proof expectation, or organization policy.

The plan item is active while it controls Discovery attention. It exits active
state when selected, deferred, rejected, closed, blocked, or superseded.

A plan item written only after Delivery started is not valid evidence that
Discovery maintained live selection state. Stop and notify the founder-dev
when the item would be a retrospective reconstruction.

Validation check:

```text
state and attention reason are explicit
```

Forbidden ownership:

```text
admitted behavior
proof status
current product authority
```

## Outcomes

A plan item should have one current outcome:

```text
active
blocked
deferred
selected
rejected
closed
superseded
```

The outcome should change future Discovery behavior. Do not record a state
that does not affect attention, selection, blocking, deferral, or closure.

## Roadmap Continuity

When a founder-dev is building a product surface across multiple runs, use
plan items for future product work that is not admitted in the current
Delivery:

```text
selected next release candidate
active product gap
deferred feature
blocked risk or dependency
candidate follow-up
```

A Delivery closure may leave Discovery plan state active, blocked, or deferred
when that state affects future product work. That is not a closure failure. It
is a separate process state whose owning plan item should name the next
attention, selection question, blocker, or deferral condition.

Do not convert future roadmap state into semantic authority unless the meaning
is durable product direction. Use Context for durable product direction and
Discovery Control records for possible work.

## Template

```yaml
plan_item:
  id: ""
  state: "active"
  possible_signal: ""
  source_basis: []
  why_attention_remains: ""
  product_area: []
  dependencies: []
  blockers: []
  candidate_disciplines: []
  selection_status: "unselected"
  close_condition: ""
  related_records: []
```

## Authority Boundary

A plan item may inform selection. It may not admit behavior, authorize Build,
replace Intent, replace Assurance, or serve as proof.

Good plan item statement:

```text
Audit export remains blocked until retention behavior is selected.
```

Invalid plan item authority:

```text
Build audit export now.
```

That requires a selected Signal, product judgment, and admitted scope in an
active Work Boundary.
