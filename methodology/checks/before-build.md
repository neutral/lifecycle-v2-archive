# Before Build Check

## Purpose

Use this check before changing target code during Delivery.

## Check

Continue only when:

```text
one active Work Boundary controls the work
an active Evidence Packet exists for the run when proof obligations exist or
proof will be needed before landing
the selected Signal is explicit
product judgment is present
product judgment states admitted behavior, why now, tradeoff, exclusions,
falsifiers, and proof consequences at the depth required by risk
recommendation basis is present
recommendation basis supports the product judgment and follows from current
repo state, not only conversation framing
assumptions, confidence, known unknowns, and falsifiers are explicit enough for
the work's risk and ambiguity
strategy-shaped work records repo-wide usage or affected-surface inventory,
definitions versus uses, distinct roles found, owning files and contracts, and
affected tests, setup, and tooling
changed recommendations record old recommendation, new evidence, changed
premise or tradeoff, new recommendation, and unchanged tradeoffs
changed product judgments record old judgment, new evidence, changed premise or
tradeoff, new judgment, and unchanged tradeoffs
intended agent outcome is stated before implementation scope for model,
terminology, architecture, process, tooling, migration, or other broad work
migration-shaped work records target reality, keep / reshape / drop criteria,
target-native naming and storage shape, provenance boundary, and final cleanup
proof for old structure residue
admitted scope is concrete
the Work Boundary tier fits risk, ambiguity, and blast radius
semantic authority is sufficient for each depended-on surface
new semantic authority slices are marked new in the Work Boundary
material discipline has been selected, rejected, or marked not applicable
selected discipline records source, version, binding, slice, and treatment
selected discipline records proof effect
discipline conflicts are resolved, rejected, or routed to a decision
allowed and restricted target change surfaces are explicit
execution boundary is explicit
proof obligations have stable ids
proof obligations name claim, source, evidence, freshness, and failure response
proof obligations reference the bound Required Checks of in-slice entries when
those entries bind checks
semantic authority update obligations are listed or marked unnecessary
open stop-work requests for the active run have explicit response outcomes
Control record requirements are listed or marked unnecessary
observation plan is listed or marked unnecessary
```

When entries in the semantic authority slice bind Required Checks, run them
before Build as the no-pre-existing-breach baseline. A check that is red
before any edit is an existing breach: route it as its own Signal instead of
absorbing the repair into this run, unless the active Work Boundary admits the
repair explicitly.

## Failure Route

If admitted scope, execution boundary, or target change surfaces are unclear,
return to `states/work-boundary-active.md`.

If product judgment is missing, under-specified, hidden inside recommendation
basis, unsupported by repo state, or falsified by current facts, return to
`states/work-boundary-active.md`.

If substantive edits already happened without the active Work Boundary and
Evidence cadence, stop and notify the founder-dev immediately. Do not continue
as a normal run by reconstructing Control records after the fact.

If recommendation basis is missing, unsupported, or narrower than the work's
risk and ambiguity, return to `states/work-boundary-active.md`.

If a recommendation changed without a recommendation delta, return to
`states/work-boundary-active.md`.

If product judgment changed without a judgment delta, return to
`states/work-boundary-active.md`.

When optional tooling is available, run:

```sh
lt verify judgment --target . --run <run-id>
lt verify basis --target . --run <run-id>
```

If semantic authority is too sparse to admit the work, use
`semantic-authority/resolve-semantic-authority-backpressure.md`.

If discipline is material but not admitted, use
`disciplines/use-discipline.md` and return to `states/work-boundary-active.md`.

If an open stop-work request exists, use
`local-support/stop-work-request.md` before Build starts.

If no selected Signal exists, use `states/signal-interpreting.md` or return to
Discovery.
