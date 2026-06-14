# Plan Map

## Purpose

Use a plan map to route Discovery attention across plan items.

A plan map is a pointer record. It helps the agent find active, blocked,
deferred, selected, closed, and superseded possible work without loading every
plan item.

## When To Use

Read the plan map at the start of Discovery.

Update the plan map when:

```text
a plan item is created
a plan item changes state
attention order changes
a dependency cluster changes
a candidate is selected
a plan item closes or becomes superseded
```

The update happens when the state change occurs. Do not wait until closure or
Delivery handoff to rebuild the map from memory.

## Minimum Contents

A plan map preserves:

```text
record id
record state
owning Discovery scope
active plan item pointers
blocked plan item pointers
deferred plan item pointers
selected plan item pointers
closed or superseded plan item pointers
dependency clusters
last review basis
```

The plan map should point to plan items instead of duplicating their rationale.

## Lifecycle

Create a plan map when Discovery tracks multiple possible items.

Update it when item state, attention order, dependency grouping, selection,
closure, or supersession changes.

The plan map is active while it routes current Discovery attention. It exits
active state when Discovery closes or refreshes the map so no open attention
remains.

If a selected, blocked, deferred, closed, or superseded item is missing from
the map because the map was not maintained live, treat the Discovery process as
failed until the founder-dev is notified and the process is repaired or
restarted from current state.

Validation check:

```text
current plan items and dependency groups are represented
```

Forbidden ownership:

```text
plan item rationale duplication
admitted behavior
proof status
current product authority
```

## Template

```yaml
plan_map:
  id: ""
  state: "active"
  planning_scope: ""
  active_items: []
  blocked_items: []
  deferred_items: []
  selected_items: []
  closed_or_superseded_items: []
  dependency_clusters: []
  last_review_basis: []
```

## Retrieval Role

The plan map answers:

```text
Where is current Discovery attention?
What is blocked?
What is deferred?
What is ready to select?
What changed since the last review?
Which plan items should enter active context?
```

Use [../../control/states.md](../../control/states.md) for state meanings and
[../../control/retrieval.md](../../control/retrieval.md) for active-context
rules.
