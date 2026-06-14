# Before Proof Check

## Purpose

Use this check before treating proof as current.

## Check

Continue only when:

```text
the final work delta is frozen for proof
the active Work Boundary still admits the final work delta
the active product judgment still matches the final work delta
the Evidence Packet existed live before substantive Build edits, or the active
Work Boundary explicitly recorded why live proof tracking was not applicable
actual touched surfaces are known
execution actions used are known
generated local artifacts are ignored or removed
declared non-changes can be checked
no new unadmitted behavior remains in the diff
no explicit product judgment exclusion was violated
all declared proof obligations have exact proof commands or explicit gaps
product judgment proof consequences have evidence or explicit gaps
discipline proof obligations have evidence or explicit rejection
the bound Required Checks of touched entries ran fresh against the final work
delta, and their last_held lines carry the new date and result
runtime names, build names, or invocation names are captured when they matter
semantic authority changed after earlier proof is either absent or rechecked
open stop-work requests for the active run have explicit response outcomes
required Control records exist or are explicitly not applicable
```

A standing Required Check may satisfy a proof obligation: reference the check
in the Evidence Packet and interpret its coverage against the entry's `What
Passing Means` and `What Passing Does Not Prove` lines. A failing Required
Check is a breach — the entry stays current, landing is blocked for the
entry's scope, and the breach becomes a new Signal; do not edit the entry to
make the check pass.

## Failure Route

If the final work delta exceeds admitted scope, return to
`states/work-boundary-active.md`.

If the final work delta contradicts product judgment, violates explicit
exclusions, or falsifies a judgment premise, return to
`states/work-boundary-active.md`.

If proof state is being reconstructed only after implementation is complete,
stop and notify the founder-dev that the Lifecycle live cadence failed.

If proof obligations changed, update the active Work Boundary before proving.

If product judgment changed, update the active Work Boundary before proving.

If discipline obligations changed, return to
`states/work-boundary-active.md` before proving.

If an open stop-work request exists, use
`local-support/stop-work-request.md` before proof is treated as current.

If the final work delta contains unadmitted behavior, return to
`states/work-boundary-active.md` or remove the unadmitted work.

If a proof command fails, update the Evidence Packet and stay in
`states/proof-active.md`.
