# Before Closure Check

## Purpose

Use this check before closing Clarity, Discovery, or Delivery state.

## Check

Continue only when:

```text
active state is explicit
Context updates, unresolved Context gaps, promotion pressure, and
recommendations are recorded when Clarity is active
no-auto-start confirmation is recorded when Clarity is active
landing or abandonment is resolved when Delivery is active
product judgment has been satisfied, superseded by reframe, or preserved as
closed Work Boundary process state
live Work Boundary and Evidence cadence was followed, or a cadence failure was
recorded and routed to founder-dev before closure
live Clarity Boundary and Context Review Packet cadence was followed for
Context edits, or a cadence failure was recorded and routed to founder-dev
before closure
runtime and learning handling are resolved or routed
knowledge promotion decisions are promoted, rejected, archived, deferred, or marked unnecessary
discipline usage that shaped the run is recorded in `disciplines_used`
discipline promotion candidates are promoted, rejected, archived, deferred, or marked unnecessary
release summary exists when release exposure matters
semantic authority update obligations are resolved or carried forward
the bound Required Checks of entries this run touched carry a last_held from
after the final work delta
open stop-work requests for the active run have explicit response outcomes
active Work Boundary is closed when Delivery is active
active Clarity Boundary and Context Review Packet are closed, superseded,
deferred, blocked, or named as remaining active when Clarity is active
records that remain active are named
remaining active records have retrieval pointers
records are off by default after closure
```

## Failure Route

If runtime or learning remains unresolved, use
`states/release-learning-active.md`.

If closure is being used to reconstruct missing live Control state, stop and
notify the founder-dev. Closure cannot make an uncontrolled run controlled.

If Clarity closure would automatically start Discovery or Delivery, stop. Close
with recommendations and let the founder-dev choose the next process.

If durable product meaning should change, use
`semantic-authority/update-product-meaning.md` before closure.

If product judgment contains durable product learning, promote the meaning into
the owning semantic authority surface before relying on it after closure.

If discipline shaped the run but `disciplines_used` is missing, update
the owning Control record before closure.

If an open stop-work request exists, use
`local-support/stop-work-request.md` before closure.

If a Control record lacks next state, update the owning record before closure.
