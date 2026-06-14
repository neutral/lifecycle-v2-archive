# Control Record State Mutations

## Purpose

Use this page when one Control record state change requires another record to
change in the same work pass.

State mutations keep active context reliable. If one record says work is active
and another says the same work is closed, the agent must spend tokens
reconstructing the truth.

## General Rule

When a Control record changes state, update:

```text
the record whose state changed
records that point to that state
the plan map or closure record when it owns the pointer
the active Work Boundary when the state change affects Delivery
```

Do not leave state changes only in chat, commit messages, or broad summaries.

## Discovery Mutations

Discovery mutations are live process-state changes. Apply them when the
selection state changes, not after Delivery has started or at final closure.
If the agent discovers that a Discovery mutation was missed and would need to
be reconstructed from memory, stop and notify the founder-dev of the Lifecycle
cadence failure before continuing.

### Plan Item Created

Create the plan item under Discovery plans. Add the plan item pointer to the
plan map when a plan map exists.

The plan item starts as `active`, `blocked`, or `deferred` depending on the
attention it should receive next.

### Plan Item Blocked

Set the plan item state to `blocked`. Record the blocker and unblock condition.
Update the plan map blocked pointers.

### Plan Item Deferred

Set the plan item state to `deferred`. Record the deferral reason and revisit
condition. Update the plan map deferred pointers.

### Plan Item Selected

Set the plan item state to `selected`. Create a selection handoff when Delivery
needs Discovery context. Update the plan map selected pointers.

The selected plan item does not admit behavior. Delivery still needs an active
Work Boundary with product judgment.

Do this before Delivery relies on Discovery selection rationale, source basis,
blockers, dependencies, candidate discipline, or semantic authority context.

### Plan Item Rejected, Closed, or Superseded

Set the plan item state to `closed` or `superseded`. Record the reason. Update
the plan map closed or superseded pointers.

Do not leave rejected work active only because it was recently discussed.

### Selection Handoff Created

Create the selection handoff under Discovery selections. Point it to the
selected plan item when there is one. The handoff may remain `active` until
Delivery consumes it as admission context.

After Delivery consumes it, the handoff can close unless future audit or
unresolved admission context keeps it active.

Do not create this handoff for the first time during Delivery closure.

## Delivery Mutations

### Work Boundary Admitted

Create or update the Work Boundary under Delivery work-boundaries. Set it to
`active`. The Work Boundary remains active while it controls Build, proof,
landing, release handling, learning, archive decisions, or closure.

Before Build begins, the Work Boundary must record product judgment. If the
judgment is missing, under-specified, unsupported, or falsified, keep the run in
Work Boundary active state.

When the Work Boundary has concrete proof obligations or the work will need
proof before landing, create or update the run's active Evidence Packet before
substantive Build edits begin.

### Build Started

Keep the Work Boundary `active`. Do not create a separate Build record unless a
target repo has a local reason to preserve Build state.

Keep the Evidence Packet `active` when proof obligations exist. Update it as
proof commands, proof gaps, declared non-change checks, or reconciliation facts
become known.

If Build discovers new scope or facts that change product judgment, update the
Work Boundary only when the discovered work remains inside the active judgment
and Work Boundary. Otherwise split, defer, abandon, or start a fresh Work
Boundary.

### Final Work Delta Frozen

Create or update the Evidence Packet. Keep the Work Boundary `active`.

The Evidence Packet starts as `active` while proof is being assembled.

### Proof Satisfied

When proof covers the final work delta, product judgment coverage, and remains
current, update the Evidence Packet to `landing-ready`.

If proof becomes stale, set the Evidence Packet back to `active` with the proof
gap or set it to `blocked` when a missing decision prevents proof.

### Reconciled and Landing Ready

Create the Landing Packet when proof, product judgment coverage, and
reconciliation are current. Set the Landing Packet to `landing-ready`.

Keep the Work Boundary `active` until closure. Landing readiness does not close
the Delivery run.

### Landed

When merge or release handoff occurs, set the Landing Packet to `landed`.

Create a release summary when runtime exposure matters. Keep the Work Boundary
`active` until release exposure, observation, learning, archive decisions, and
closure are resolved.

### Learning Promoted, Rejected, Deferred, or Archived

Create a knowledge promotion decision when learning may become product
authority, including durable learning extracted from product judgment. Set it
to `closed` after the decision is made.

Create an archive decision when material should remain history only. Set it to
`archived` after closure records the archive pointer.

### Delivery Closed

Create the closure record. Set the closure record to `closed`.

Record product judgment outcome in the closure record before closing the Work
Boundary.

Set the Work Boundary to `closed`.

Set run-local Evidence Packets, Landing Packets, release summaries, and
promotion decisions to `closed` when they no longer control active work.

Leave a record `active`, `blocked`, `deferred`, `landing-ready`, or `landed`
only when the closure record explicitly carries that remaining state forward.

### Delivery Abandoned

Create a closure record that records abandonment. Set the Work Boundary to
`closed`.

Close, archive, or leave active any sibling records according to what future
work still needs. Abandonment must record product judgment outcome and must not
leave hidden active state.

## Semantic Authority Obligation Mutations

When semantic authority update obligations change, update the active
Work Boundary and the owning semantic authority entry in the same work pass
when possible.

Use these obligation outcomes:

```text
satisfied
unnecessary
blocked
deferred
superseded
```

Before closure, every semantic authority update obligation should have one of
those outcomes.

## Conflict Response

When records disagree about state:

```text
1. Stop before Build, landing, release, or closure.
2. Identify the owner record for the disputed state.
3. Update pointers and state in the owner record.
4. Update dependent records.
5. Continue only after one current state is clear.
```

Do not resolve state conflicts by adding a broad summary while leaving the
conflicting records unchanged.
