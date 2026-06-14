# Route

## Purpose

Use this page to map the current target-codebase situation to the installed
methodology state page that owns action.

## Routing Table

```text
no active Lifecycle records -> states/no-active-work.md
Context pressure or broad product meaning work -> states/clarity-active.md
unclear possible work -> states/discovery-active.md
candidate Signal exists -> states/signal-interpreting.md
selected Signal needs product judgment and admission -> states/work-boundary-active.md
admitted product judgment and scope in the active Work Boundary permit target work -> states/build-active.md
final work delta needs proof -> states/proof-active.md
proofed work needs handoff -> states/landing-ready.md
landed work has release or learning handling -> states/landed.md
runtime output or learning needs classification -> states/release-learning-active.md
landing, learning, archive, or abandonment is resolved -> states/closure-active.md
discipline may materially constrain the work -> disciplines/use-discipline.md, then the owning state
open stop-work request exists -> local-support/stop-work-request.md, then the owning state selected by the request outcome
```

## Conflict Rule

When two records imply different states, use the most constrained active state.
Prefer Delivery over Clarity or Discovery when an active Work Boundary exists.
Prefer Clarity over Discovery when active Context maintenance records exist and
no concrete Signal overrides them. Prefer proof or landing state over build
state when a final work delta has been declared.

If the conflict changes allowed action, stop and update the owning Control
record before continuing.

If discipline conflicts with product semantic authority, organization
authority, product judgment, admitted scope, proof, or closure, return to
`states/work-boundary-active.md` before Build proceeds.
