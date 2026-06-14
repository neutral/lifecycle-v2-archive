# First run

## Purpose

Use this page for the first agent invocation after Lifecycle is installed in a
target codebase.

After setup, the agent starts from installed methodology, not model rationale.

## Entry Point

Every invocation starts here:

```text
.lifecycle/methodology/start.md
```

That page tells the agent how to find active state, route to the owning state
page, load active context, resume work, and stop with explicit process state.

## Concrete Signal Path

For a concrete Signal:

```text
1. Read .lifecycle/methodology/start.md.
2. Route through .lifecycle/methodology/route.md.
3. Check .lifecycle/stop-work-requests/ when an active run exists.
4. Use .lifecycle/methodology/states/signal-interpreting.md.
5. Use .lifecycle/methodology/semantic-authority/retrieve-product-meaning.md when product meaning governs the work.
6. Read .lifecycle/disciplines/catalog.md when installed discipline may materially constrain the work.
7. Create the active Work Boundary under records/control/delivery/work-boundaries/ with product_judgment, authority treatment, scope, execution boundary, proof obligations, and update obligations.
8. Use .lifecycle/methodology/states/work-boundary-active.md and run .lifecycle/methodology/checks/before-build.md before Build.
9. Record selected discipline, selected slices, treatment, product judgment effect, and proof effects when discipline shapes the run.
10. Build inside the Work Boundary and execution boundary.
11. Record exact proof commands, product judgment coverage, and runtime names in the Evidence Packet.
12. Produce Evidence Packet, Landing Packet, and closure record as the run requires.
13. Run .lifecycle/methodology/checks/before-closure.md before closure.
```

## Unclear Work Path

For unclear next work:

```text
1. Read .lifecycle/methodology/start.md.
2. Route through .lifecycle/methodology/route.md.
3. Use .lifecycle/methodology/states/discovery-active.md.
4. Update Discovery plan items under records/control/discovery/plans/.
5. Produce a selection handoff under records/control/discovery/selections/ when Delivery needs context.
6. Use .lifecycle/methodology/control-records/selection-handoff.md before handing off to Delivery.
```

## Context Clarity Path

For broad Context, rationale, strategy, corpus, canonicalization, freshness, or
meaning work:

```text
1. Read .lifecycle/methodology/start.md.
2. Route through .lifecycle/methodology/route.md.
3. Use .lifecycle/methodology/states/clarity-active.md.
4. Create the active Clarity Boundary under records/control/clarity/boundaries/.
5. Inventory source material under records/control/clarity/inventories/.
6. Track the Context surface contract plus route, content, canonicalization,
   promotion, and retrieval checks in records/control/clarity/reviews/.
7. Update Context only inside the active Clarity Boundary.
8. Close with records/control/clarity/closures/ and recommendations only.
9. Do not start Discovery or Delivery automatically.
```

## Compact Work

Use compact records for small local work.

Compact records still need:

```text
state
scope
authority treatment
product judgment when Delivery is active
discipline usage when material
execution boundary when Delivery is active
proof obligations when Delivery is active
product judgment coverage when proof or landing is active
stop-work request outcome when a request changed durable state
closure or next state
```

Do not leave future state only in chat. Persist the state in the owning Control
record when future work depends on it.

## Starting Another Process Later

After a process closes, commit the semantic authority, target changes, notes,
and Control records that record that process. Before the next independent
Lifecycle process begins, reset only `records/control/` so current HEAD does
not carry prior process state as active working material.

Do not reset semantic authority records. They are the durable product state that
the next process should retrieve.
