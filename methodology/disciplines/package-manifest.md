# Discipline Package Manifest

## Purpose

Use this page as the human-readable compiler manifest for installed discipline
support.

The compile install workflow reads this page, validates referenced sources, and
writes methodology guidance under `.lifecycle/methodology/disciplines/`
and generated discipline runtime material under
`.lifecycle/disciplines/`.

This manifest owns the installed discipline methodology guidance.
Install profiles may add separate discipline package manifests when a
target or test needs concrete source package material.

## Package

| Field | Value |
| --- | --- |
| package type | disciplines |
| id | lifecycle-disciplines |
| name | Lifecycle Discipline |
| version | 0.1.0 |
| source root | methodology/disciplines |

## Installed Source Pages

| id | source | install path |
| --- | --- | --- |
| overview | overview.md | disciplines/overview.md |
| catalog | catalog.md | disciplines/catalog.md |
| package-contract | package-contract.md | disciplines/package-contract.md |
| surface-content-contract | surface-contract.md | disciplines/surface-contract.md |
| binding-contract | binding-contract.md | disciplines/binding-contract.md |
| use-discipline | use-discipline.md | disciplines/use-discipline.md |
| checks-overview | checks/overview.md | disciplines/checks/overview.md |
| usage-adequacy | checks/usage-adequacy.md | disciplines/checks/usage-adequacy.md |

## Generated Outputs

| id | source | install path |
| --- | --- | --- |
| discipline catalog | Discipline Packages | .lifecycle/disciplines/catalog.md |
| discipline lock | selected discipline packages | .lifecycle/disciplines/discipline.lock |

## Discipline Packages

Core methodology does not bundle concrete discipline packages. Install
profiles may include additional discipline package manifests when a
target or test needs selected source package material.

| id | source | source type | discipline | version |
| --- | --- | --- | --- | --- |
