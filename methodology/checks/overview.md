# Checks

## Purpose

Use this folder for installed methodology checks.

Checks are repeatable inspections that protect state transitions, product
judgment, authority boundaries, proof freshness, landing readiness, and closure.
They do not replace the active state page, the active Control record, or
target-specific proof.

Optional tooling may automate parts of these checks. The manual check remains
the authority path. A tool finding is an observation until the agent records the
interpreted effect in the owning record or semantic authority entry. Judgment
findings belong in the active Work Boundary, not semantic authority storage.

Stable check ids and check ownership live in the Lifecycle source file
`methodology/checks/check-registry.contract.json`. Generated tooling support may
copy that registry into `.lifecycle/tooling/support/`. The registry does not
replace the check pages.

## Pages

Use [before-build.md](before-build.md) before changing target code under an
active Work Boundary.

Use [before-proof.md](before-proof.md) before treating proof as current.

Use [../disciplines/checks/usage-adequacy.md](../disciplines/checks/usage-adequacy.md)
when selected or material discipline shapes Work Boundary, Build, Proof,
or Closure.

Use [before-landing.md](before-landing.md) before landing or handing off a final
work delta.

Use [before-closure.md](before-closure.md) before closing active work.

Use [installed-repo-checks.md](installed-repo-checks.md) for broad target repo
checks.
