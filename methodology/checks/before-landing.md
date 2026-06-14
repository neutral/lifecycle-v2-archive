# Before Landing Check

## Purpose

Use this check before landing a final work delta or declaring the work
landing-ready.

## Check

Continue only when:

```text
the Landing Packet names the final work delta
current proof supports the final work delta and admitted product judgment
the Evidence Packet covers admitted product judgment, tradeoffs, exclusions,
and falsifiers
the Evidence Packet was maintained live or records an admitted reason live proof
tracking was not applicable before Build
the final work delta matches admitted scope and product judgment in the active
Work Boundary
declared non-changes were checked
semantic authority update obligations are resolved or carried forward
the bound Required Checks of touched entries carry a last_held from after the
final work delta, and no binding the run relies on is broken
the Landing Packet points to current evidence
release exposure and runtime handling are explicit when relevant
release exposure decisions are admitted by the execution boundary
open stop-work requests for the active run have explicit response outcomes
handoff target and next state are explicit
```

## Failure Route

If proof is stale, return to `states/proof-active.md`.

If Landing would rely on Control records reconstructed after the work instead
of live Work Boundary and Evidence cadence, stop and notify the founder-dev.

If the final work delta no longer matches the active Work Boundary, return to
`states/work-boundary-active.md`.

If the final work delta contradicts product judgment or violates an explicit
exclusion, return to `states/work-boundary-active.md`.

If an open stop-work request exists, use
`local-support/stop-work-request.md` before declaring landing readiness.

If release exposure is unresolved, continue through `states/landed.md` after
landing.
