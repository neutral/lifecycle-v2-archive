# Lifecycle Foundation implementation record

> Status: Draft implementation

Lifecycle Foundation implements the Director–Worker operating model through its
canonical CLI, public protocol, and Runtime. This record describes the selected
contracts, implemented capabilities, dependencies, and verification limits.

## Selected contracts

| Coordinate | Selection |
| --- | --- |
| Source revision | `lifecycle.foundation.1.0.0-rc.17` |
| Package version | `1.0.0` |
| Repository contract | `lifecycle.repository.v22` |
| Runtime and interface protocols | `lifecycle.runtime.foundation.v17`, `lifecycle.interface.foundation.v17` |
| Provider adapter | `lifecycle.provider-adapter.v7` |
| Control Store | `lifecycle.control-record-store.v2`, SQLite `user_version = 3` |
| Revision, event, reduction, lifecycle | v2, v6, v5, v7 |
| Atlas processor | `atlas-reference-validator` 0.8.0, authored format 1 |
| Atlas specification and processor revision | `2c7a78540ac30138218b12803f1c045cee8b109a` |
| Selected Codex CLI | `0.153.4`, descriptor range `>=0.153.4 <0.154.0` |

The complete coordinate inventory remains in
[Evolution](spec/EVOLUTION.md#current-foundation-rc17-cut). Package version
`1.0.0` does not establish release status or compatibility. The implementation
supports fresh targets only. It refuses predecessor and mixed coordinates; it
supplies no migration or rebinding route for retained work.

## Implementation

The Director–Worker roles remain actor-neutral. A Director supplies direction
and makes the decisions reserved at that work level; a Worker gathers support
and performs authorized work. Role names do not transfer authenticated
Director authority or introduce a human approval requirement.

The Runtime retains Knowledge and exact Atlas processing, bounded Projection,
semantic Agent Work Products, authenticated admission, reversible Candidate
Revisions and their reconstructible Carriers, Checks, independent review,
Evidence verification, exact-parent integration, conditional canonical
application, no-ship, Closure, and Store archive. Runtime protocol and CLI
requests continue to use the selected rc.17 schemas.

Work Delegation retains finite resource grants separately from mandate and
terminal authority. Save, Run, and Stop use the existing Process and Activity
owners. Stable inspection retains exact subjects as the Journal advances.
Provider outcome, semantic validity, and Candidate advancement remain distinct;
useful valid output can survive a failed provider, and invalid output does not
advance a Candidate merely because the provider succeeded.

The execution backend and Execution Image source retain disposable Cells,
immutable inputs, output retrieval, Containment, Retirement, and bounded owned
Reclamation. Recovery observes the originally selected execution or transaction
without substituting new defaults or redispatching an uncertain effect. The
selected source includes recovery of Agent Cells that were allocated but never
dispatched and private provider-credential continuity under its existing exact
custody contract.

Checks retain an isolated tree/index view of the selected baseline or final
object closure. Multiple Checks can share a Boundary or Seal proof subject
while preserving separate execution and Retirement obligations. The
[Runtime test overview](../runtime/tests/overview.md)
records the finite source scenarios and their limits.

## Dependencies and source builds

The exact Atlas 0.8.0 processor remains under
[`third-party/atlas-reference-validator/`](../third-party/atlas-reference-validator/).
Its original license, upstream revision, and file inventory are retained in
[`PROVENANCE.json`](../third-party/atlas-reference-validator/PROVENANCE.json).
Current Atlas releases are not substitutes for that runtime dependency.
The separate project Atlas preserves design context for this implementation.

The [README](../README.md) gives source prerequisites and CLI build commands.
Local Runtime and Execution Image recipes remain reference source; creating or
operating an image is a separate activity. Non-UI regression tests and explicit
qualification harness source remain available for inspection. Default source
checks do not invoke installed-package qualification or a live provider.

## Material limits

The specification is Draft. An authenticated Publication Statement and an exact
implementation conformance claim are separate evidence requirements. Local
compilation and deterministic tests establish only the boundaries they exercise.

Product use requires a separate fresh target with complete valid tracked Atlas
Knowledge, the exact selected installation and provider resources, and the
configured authenticated authority. The development repository is not an
operated target. The selected source permits one preparation per Delivery and
does not supply a predecessor migration, automatic Director scheduler, human
Worker provider, or remote execution backend.

Historical operated observations concern their recorded source and resources.
They do not establish qualification of later recovery or custody changes.
Independent multi-Delivery models, broader fuzz campaigns, and current-image
operated qualification remain unverified boundaries.
