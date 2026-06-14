# Discovery Control Records

## Purpose

Use this folder for the Control records Discovery creates, reads, updates, and
closes.

Discovery Control records preserve possible-work and selection state. They let
future Discovery loops continue from current blockers, dependencies, deferrals,
rejections, candidate readiness, and selection rationale without re-deriving
that state.

Discovery Control records are process-local. A later independent process may
read them for handoff, audit, supersession, or history, but it should not share
their mutable state. After a closed process is committed, start the next
process from fresh current Control records.

Use [../../control/overview.md](../../control/overview.md) for shared control
mechanics.

## Live Cadence

Discovery records must be updated while Discovery is deciding, not after
Delivery has already consumed the decision.

Use this cadence:

```text
possible work should persist -> create or update Plan Item
attention order or item state changes -> update Plan Map
founder-dev selects work from Discovery context -> mark Plan Item selected
Delivery needs Discovery context -> create Selection Handoff before Work Boundary relies on it
Discovery closes -> close, defer, block, supersede, or leave explicit active state
```

If a Plan Item, Plan Map, or Selection Handoff would be written only because
the agent reached the end of the run and noticed it was missing, do not treat
that as valid process state. Stop, notify the founder-dev of the Lifecycle
cadence failure, and repair or restart from an explicit current state.

## Records

Discovery uses these Control records:

```text
plan map
plan item
selection handoff
```

Use [plan-map.md](plan-map.md) to find and route possible work.

Use [plan-item.md](plan-item.md) to preserve one possible Signal and its
selection state.

Use [selection-handoff.md](selection-handoff.md) to preserve the selected
Signal and the Discovery context Delivery may need for admission.

Use [../../control/contracts.md](../../control/contracts.md) for universal
Control record contract mechanics. The pages in this folder own the
record-specific minimum contents and templates for Discovery records.

## Agent Path

When running Discovery, use this path:

```text
1. Read the plan map.
2. Read active, blocked, or deferred plan items that matter to the current
   question.
3. Create or update plan items as candidate state changes.
4. Update the plan map when item state, attention order, dependency grouping,
   or selection changes.
5. Produce a selection handoff when a selected Signal moves to Delivery with
   useful Discovery context.
```

Use shared control rules only for mechanics:

```text
state -> ../../control/states.md
retrieval -> ../../control/retrieval.md
contract -> ../../control/contracts.md
closure -> ../../control/closure.md
checks -> ../../control/checks.md
universal template header -> ../../control/templates.md
```

## Authority Boundary

Discovery Control records may guide selection. They do not admit behavior,
authorize Build, replace semantic authority, or serve as proof.

Durable residue routes by role:

```text
selected Signal -> Delivery handoff
open, deferred, rejected, or blocked work -> Discovery Control records
product meaning -> semantic authority through semantic authority update or knowledge promotion
proof -> proof
observation -> observation
temporary reasoning -> working notes until distilled
```
