# Control record checks

## Purpose

Use these checks to keep Control records small, current, retrievable, and tied
to product judgment and decisions.

Checks should protect the Control record job. They should not reward longer
records.

## Shape Checks

Before treating a Control record as usable, confirm:

```text
record id exists
record type exists
record state is explicit
owning process or run is clear
scope is clear
authority treatment is clear
related record pointers exist when referenced
context eligibility is explainable
```

If a required field does not apply, it should say `none` or `not applicable`.

## Delivery Checks

Before substantive Delivery edits, confirm:

```text
active Work Boundary exists
active Work Boundary records product judgment before Build changes production behavior
active Evidence Packet exists for the run when proof obligations exist or proof
will be needed
the Work Boundary and Evidence Packet share the Delivery run id
```

## Clarity Checks

Before substantive Context edits in a Clarity run, confirm:

```text
active Clarity Boundary exists
Context scope and review depth are explicit
allowed Context mutations and explicit exclusions are named
source material policy is stated before source material shapes Context
Context Review Packet exists and names the Context surface contract when route,
content, canonicalization, promotion, or retrieval checks will be needed
no-auto-start rule is present
```

Before closing Clarity, confirm:

```text
Context updates match the active Clarity Boundary
route-only work did not mark leaves reviewed without content review
review_status and freshness labels are honest
canonical, stale, duplicate, conflict, and supersession decisions are recorded
promotion pressure is recorded without silently updating narrower surfaces
retrieval proof is current or blocked with reason
recommendations are explicit and do not start Discovery or Delivery
```

## Discovery Checks

Before preserving possible work, confirm:

```text
current plan map was read when it exists
active, blocked, deferred, or selected plan items relevant to the prompt were read
new candidate state that should persist has a live plan item
plan map was updated when attention order, item state, dependency grouping, or selection changed
```

Before handing Discovery-selected work to Delivery, confirm:

```text
selected plan item is marked selected when Discovery created the selection
plan map points to the selected item when a plan map exists or multiple items are tracked
selection handoff exists before Delivery relies on Discovery context
selection handoff points to the selected plan item when one exists
selection handoff names the Delivery handoff target before Delivery consumes it
```

If any of these records are missing because Discovery state was only noticed
after Delivery began or at closure, stop, notify the founder-dev that Lifecycle
cadence failed, and repair or restart from an explicit current state.

Before landing Delivery work, confirm:

```text
active Work Boundary exists
product judgment is present, current, and checked against the final work delta
execution boundary is present
execution boundary was followed
proof obligations are satisfied
Evidence Packet covers the final work delta and admitted product judgment
proof is current against the final work delta and admitted product judgment
declared non-changes are checked
Landing Packet exists or is ready
required Control records are produced
semantic authority update obligations are resolved or marked unnecessary
semantic authority backpressure blockers are resolved or explicitly not applicable
```

## State Transition Checks

Before changing process state, confirm:

```text
current state is known
next state is named
trigger is explicit
required Control record exists or will be created in the transition
required proof or decision exists
failure response is known
```

Do not move state forward only because the work feels done.

## Retrieval Checks

Before loading more history, confirm:

```text
active Control records were checked
records with open obligations were checked
closed records are loaded only by reference or proof need
superseded records are loaded only for supersession reasoning
archived records are loaded only for audit or historical investigation
recent records are not treated as active only because they are recent
```

## Closure Checks

Before closing Discovery attention, confirm:

```text
plan state is current
selected, deferred, blocked, rejected, closed, or superseded outcomes are recorded
selection handoff exists when Delivery needs Discovery context
open Discovery attention is either closed or explicitly left active
```

Before closing a Delivery run, confirm:

```text
closure record exists
state changes are recorded
open obligations are resolved, deferred, blocked, or carried forward
promoted learning points to semantic authority storage
archive decisions explain why material is history only
closed records are off by default
next retrieval pointer exists when follow-up work remains
```

Before starting a new independent process, confirm:

```text
the prior process is closed or explicitly carried forward
the prior process's Control records were committed when they are needed for history
current records/control/ is neutral or contains only the new process's Control records
semantic authority records were not reset
```

## Authority Checks

Confirm that Control records do not become product authority by accident:

```text
product meaning that should govern future work is in semantic authority storage
Control records with product-relevant facts point to semantic authority updates
closed Work Boundaries and closed product judgments are not treated as current
product authority
Evidence Packets prove work but do not admit new behavior
Landing Packets hand off a landing but do not define product meaning
active Work Boundaries record missing earlier semantic authority as blockers
instead of letting later surfaces or implementation carry it
```

## Proof And Reconciliation Checks

Confirm:

```text
proof obligations name ids, claims, sources, evidence, freshness, and failures
Evidence Packet covers the final work delta
Evidence Packet covers the admitted product judgment, tradeoffs, exclusions,
falsifiers, and proof consequences
Evidence Packet maps evidence to proof obligation ids
proof was refreshed after target, authority, or Work Boundary changes
declared behavior was checked
declared non-changes were checked
assurances were checked when applicable
execution boundary compliance was checked
actual work delta matches the active Work Boundary
```

## Runtime And Learning Checks

Before closure, confirm:

```text
runtime exposure is handled or not applicable
runtime outputs are classified when release exposure exists
learning candidates are promoted, rejected, archived, deferred, or not applicable
durable learning from product judgment is promoted only after being rewritten as
semantic authority meaning
knowledge promotion names the target semantic authority surface when promoted
archive decisions explain why material is history only
```

## Drift Response

When a check fails, update the smallest record that restores control.

Do not create broad summaries to compensate for missing state. Fix the missing
state, pointer, obligation, proof status, or closure decision at the owning
record.

If substantive edits already happened without the live Work Boundary and
Evidence cadence, stop and notify the founder-dev immediately. The response is
not to write retrospective records that imply the cadence existed.
