# Clarity Closure Record

## Purpose

Use a Clarity Closure Record to close one Clarity run.

Closure records what Context changed, what remains unresolved, and what the
founder-dev may inspect next. It does not start Discovery or Delivery.

## Create When

Create a Clarity Closure Record when the admitted Context pass is complete,
blocked, deferred, superseded, or intentionally archived.

## Minimum Contents

Every Clarity Closure Record should preserve:

```text
id
state
owning_clarity_run
context_scope
outcome
context_entries_updated
review_depth_completed
unresolved_context_gaps
promotion_pressure
recommendations
founder_review_required
records_remaining_active
no_auto_start_confirmation
next_retrieval_pointer
```

## Template

```yaml
clarity_closure_record:
  id: ""
  state: "closed"
  owning_clarity_run: ""
  context_scope: []
  outcome: ""
  context_entries_updated:
    created: []
    updated: []
    moved: []
    superseded: []
    deferred: []
  review_depth_completed: ""
  unresolved_context_gaps: []
  promotion_pressure: []
  recommendations:
    discovery_candidates: []
    delivery_candidates: []
    further_clarity_candidates: []
    semantic_authority_candidates: []
    founder_questions: []
  founder_review_required: []
  records_remaining_active: []
  no_auto_start_confirmation: "No Discovery, Delivery, or additional Clarity process was started automatically."
  next_retrieval_pointer: ""
```

## Closure Rule

Close with recommendations only. If the next step is obvious, state it as a
recommendation for founder-dev inspection rather than starting it.
