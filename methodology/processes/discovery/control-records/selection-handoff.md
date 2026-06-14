# Selection Handoff

## Purpose

Use a selection handoff when Discovery selects a Signal and Delivery may need
the selection context for admission.

The selected Signal is the Delivery input. The handoff preserves why Discovery
selected that Signal, which state informed the selection, and which plan
updates followed from the selection.

## When To Use

Create a selection handoff when:

```text
Discovery selects a Signal from multiple candidates
selection rationale should survive into Delivery admission
known open questions matter to Framing
plan item state changes because of selection
future audit needs the Discovery-to-Delivery trace
```

Skip a separate handoff when the founder-dev provides a concrete Signal and no
Discovery context matters.

Create the handoff before Delivery consumes the Discovery context. If Delivery
already relied on selection rationale, source basis, blockers, dependencies,
candidate discipline, or semantic authority context and no live handoff existed,
stop and notify the founder-dev that Lifecycle cadence failed.

## Minimum Contents

A selection handoff preserves:

```text
record id
record state
selected Signal
selection rationale
source basis
known open questions
plan updates caused by selection
admission context pointers
candidate discipline packages and bindings when they affect admission
Delivery handoff target
```

## Lifecycle

Create a selection handoff when Delivery needs Discovery context for admission.

Update it when selected Signal, source basis, known open questions, plan
updates, candidate discipline, or handoff target changes before Delivery
consumes it.

The handoff is active until Delivery consumes it as Signal input or the
selection is abandoned, closed, or superseded.

Closing or landing Delivery cannot create the handoff for the first time. At
closure, the handoff may be closed, superseded, archived, or referenced, but it
cannot be backfilled as if it had constrained Delivery earlier.

Validation check:

```text
selected Signal and non-authority treatment are explicit
```

Forbidden ownership:

```text
admitted behavior
Build authorization
proof status
current product authority
```

## Handoff Rule

Create a selection handoff when Delivery needs:

```text
selection rationale
known open questions
important source basis
authority or proof context
candidate discipline package, binding, or catalog pointer
blockers or dependencies that shape admission
```

Delivery consumes Discovery output through a typed handoff. Delivery does not
depend on Discovery internal reasoning.

When Discovery created the selection, the handoff should point to the selected
plan item and to the current Delivery handoff target. The plan map should also
represent the selected item.

Plans can say:

```text
Audit export remains blocked by retention policy.
```

Plans cannot authorize:

```text
Build audit export now.
```

That requires:

```text
selected Signal
-> Work Boundary active
-> Build active
```

## Template

```yaml
selection_handoff:
  id: ""
  state: "active"
  selected_signal: ""
  selection_rationale: ""
  source_basis: []
  known_open_questions: []
  plan_updates: []
  candidate_disciplines: []
  admission_context_pointers: []
  delivery_handoff_target: ""
```

## Delivery Boundary

Delivery may use a selection handoff as admission context. The handoff does
not admit behavior or state product judgment.

The Delivery boundary remains:

```text
selected Signal
-> Framing
-> product judgment
-> admitted scope in the active Work Boundary
```
