# Discovery Gates

## Purpose

Use this page to decide whether one Discovery state may advance to the next.

Discovery gates keep selection work explicit without turning possible work into
admitted product behavior.

## Enter Discovery

Enter Discovery when useful work is unclear or attention needs selection.

Required context:

```text
prompt or current question
current semantic authority when product meaning matters
existing plan map, when one exists
active, blocked, deferred, or selected plan items relevant to the question
```

Continue when Discovery can reduce uncertainty or preserve useful possible-work
state.

Route to Delivery when a concrete Signal already exists.

Create or update live Discovery Control state before selection work survives
the current thought. A prompt such as `continue`, `pick something`, or `what is
next` starts Discovery unless it already contains a concrete Delivery Signal.
Do not wait until Delivery closure to create the Plan Item, Plan Map, or
Selection Handoff.

## Before Candidate Set Prepared

Prepare candidate Signals only after the agent has enough current context to
avoid stale or duplicate candidates.

Check:

```text
Direction or Context was read when product direction matters
relevant Intent, Assurance, Blueprint, or Description entries were read when they shape selection
plan map was checked when it exists
active, blocked, and deferred plan items were checked when relevant
new or changed candidate state was recorded in a live plan item when it should persist
the plan map was updated when active attention, dependency grouping, or item state changed
target, proof, observation, or prior Control records were read only when needed
```

Continue when candidates can name source basis, usefulness, known unknowns, and
selection question.

Stop when product direction, authority, target facts, proof, observation, or
plan state is too ambiguous to prepare candidates.

## Before Founder Selection Needed

Ask for founder selection only when candidates are specific enough to choose
from.

Each candidate should state:

```text
candidate Signal
source basis
why useful now
current-state facts used
likely semantic authority involved
known unknowns
risk or sensitivity
selection question
```

Continue when the founder-dev can select, defer, reject, or request more
Discovery without reading broad background.

Return to Discovery active when candidates are vague, duplicated, stale, or
unsupported.

## Before Selection Recorded

Record the selection treatment before handing work to Delivery.

For each candidate, record one treatment:

```text
selected
deferred
rejected
blocked
closed
more Discovery requested
left active
```

Continue when the plan item and plan map reflect the treatment.

Stop when the decision authority or selection rationale is missing.

Stop and notify the founder-dev when the selected, deferred, rejected, blocked,
closed, or active outcome was only reconstructed after Delivery already began.
That is a Discovery cadence failure, not a normal closure repair.

## Before Selection Handoff Produced

Create a selection handoff when Delivery needs Discovery context.

Required record:

```text
records/control/discovery/selections/selection.<slug>.md
```

Create the handoff when Delivery needs:

```text
selection rationale
known open questions
important source basis
authority or proof context
blockers or dependencies that shape admission
```

Skip the handoff when the selected Signal is self-contained and no Discovery
context should shape admission.

The handoff must be live before Delivery consumes it. If the active Work
Boundary already depends on Discovery selection rationale, source basis,
blockers, dependencies, candidate discipline, or semantic authority context that
was not captured in a live handoff, stop and notify the founder-dev of the
Lifecycle failure.

## Before Plan State Refreshed

Refresh plan state before closing Discovery or starting Delivery from a
selected Signal.

Check:

```text
selected plan items are marked selected
deferred items have revisit conditions
blocked items have unblock conditions
rejected or closed items record the reason
superseded items point to the newer state
plan map points to current items
Selection Handoffs point to selected plan items when Discovery created the selection
```

Continue when future Discovery can resume without recomputing the same
selection work.

Stop when blockers, dependencies, deferrals, or closures remain unrecorded.

## Before Closed or Left Active

Discovery may close without selecting work.

Close Discovery when:

```text
no open Discovery attention remains
plan state is current
no selected Signal needs handoff
no blocker or dependency is hidden
```

Leave Discovery active when:

```text
more Discovery is explicitly requested
candidate work remains active
blocked or deferred work should stay retrievable
selection is pending
```

Stop when the next Discovery state is unclear.

Do not close Discovery by writing missing plan state for the first time at the
end of the run. Closure can refresh, close, defer, block, or supersede live
state; it cannot turn absent Discovery state into valid prior process state.
