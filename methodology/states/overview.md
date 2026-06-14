# States

## Purpose

Use this folder for the source state model that setup turns into installed
methodology state pages.

[state-model.md](state-model.md) names when each state applies, what to read
first, what artifact controls the moment, what actions are allowed, what to
produce or update, which check must pass, where failures route, and how to stop
with explicit state.

Delivery states treat product judgment as the weighing step between retrieved
authority and admitted action. It is recorded in the active Work Boundary before
Build, checked by proof and reconciliation, and closed or promoted during
closure.

## State Path

```text
no-active-work
-> discovery-active
-> signal-interpreting
-> work-boundary-active
-> build-active
-> proof-active
-> landing-ready
-> landed
-> release-learning-active
-> closure-active
```
