# Release Summary

## Purpose

Use a release summary to preserve release exposure and runtime observation
context.

The release summary helps future agents understand what behavior reached
runtime, what observation plan applied, and which runtime outputs became
supporting evidence, incident inputs, learning candidates, or follow-up
Signals.

## When To Use

Create a release summary when landed work is exposed to runtime or release
handling matters for closure.

Use it to preserve:

```text
released behavior or exposed change
release surface
observation plan status
runtime observations
incident inputs
supporting evidence
learning candidates
discipline promotion candidates when runtime output or release handling creates them
product judgment learning candidates when runtime output confirms, falsifies, or changes them
follow-up Signal pointers
```

## Minimum Contents

A release summary preserves:

```text
record id
record state
owning Delivery run
released behavior or exposed change
release surface
observation plan status
runtime observations
incident inputs, supporting evidence, or learning candidates
discipline promotion candidates, when present
product judgment learning candidates, when present
follow-up Signal pointers, when needed
```

## Lifecycle

Create a release summary when release exposure matters for closure.

Update it when release surface, observation plan status, runtime observations,
incident inputs, supporting evidence, learning candidates, product judgment
learning candidates, or follow-up Signals change.

The release summary is active while runtime outputs are being classified. It
exits active state when runtime treatment is explicit and any learning,
incident, archive, or follow-up state has an owning record.

Validation check:

```text
runtime treatment is explicit
```

Forbidden ownership:

```text
admitted behavior
proof status for the final work delta
durable product authority
```

## Template

```yaml
release_summary:
  id: ""
  state: "landed"
  owning_delivery_run: ""
  exposed_change: ""
  release_surface: []
  observation_plan_status: ""
  runtime_observations: []
  classified_outputs:
    supporting_evidence: []
    incident_inputs: []
    learning_candidates: []
    discipline_promotion_candidates: []
    product_judgment_learning_candidates: []
    follow_up_signals: []
```

## Authority Boundary

Runtime observations do not become product authority by default. Durable
runtime-derived product meaning enters semantic authority only through knowledge
promotion.

Discipline promotion candidates do not become product authority by
default. Rewrite them as product-specific accepted statements before promotion.

Behavior-changing runtime follow-up starts as a Signal.
Runtime output that changes product judgment starts as a Signal or learning
candidate; it does not mutate closed semantic authority by itself.
