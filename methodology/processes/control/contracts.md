# Control record contracts

## Purpose

Use this page for shared contract rules that apply to persisted Control
records.

Contracts are smaller than templates. A contract says what future work must be
able to recover. A template is one way to write that contract down.

Process-local record pages own record-specific minimum contents. Use this page
for the universal state, lifecycle, and right-sizing contract every Control
record follows.

## Universal Contract

Every persisted Control record should make these fields easy to find:

```text
record id
record type
record state
owning process or run
scope
source Signal, source record, or source process when relevant
product judgment, decision, boundary, obligation, proof status, handoff, or closure state when relevant
Context scope, review depth, source treatment, review checks, recommendations,
or Context closure state when relevant
authority treatment
context eligibility reason
related record pointers
next action or closure condition
```

Compact records may combine fields when the meaning is obvious. They should
not omit record state, scope, authority treatment, or the pointer that lets a
future agent find the related work.

## Machine-Addressable Contract

Control records should expose process state through stable, readable fields
that an agent can inspect manually and a tool can check mechanically.

The methodology page that owns a record rule is the source for any checkable
contract. Generated tooling support may carry a derived copy of that contract,
but it does not add process state or change the record's authority treatment.

Process-local Control record contracts may also have adjacent
`*.contract.json` files. Those files are source-owned contract artifacts. They
expose record fields, field ownership, stable references, and manual fallback
paths for optional tooling support. They do not replace the readable record
page.

A field is machine-addressable when it has:

```text
stable field name
stable id, pointer, or explicit none value
visible owning process, run, or authority relationship
current state or freshness basis when relevant
readable prose context nearby
```

Tool observations become Control record state only when the agent interprets
the observation and records the effect in the owning Control record. Product
judgment observations belong in the active Work Boundary or judgment delta.

## Simplification Rule

Do not remove readable minimum contents or manual checks only because a
source-owned contract exists.

Contract-backed simplification is allowed only when:

```text
the rule remains readable in the owning methodology page
the source-owned contract exposes the checkable form
generated tooling support derives from that contract
the manual fallback remains clear
setup verification can detect missing generated support when support exists
```

Until those conditions hold, keep the readable methodology list and use the
contract as an inspection aid.

## State Contract

Every persisted Control record should use one current record state:

```text
active
blocked
deferred
landing-ready
landed
closed
superseded
archived
```

The state is a retrieval signal. It tells the agent whether the record should
enter active context by default, only by reference, or only for audit.

## Lifecycle Contract

Every Control record type should define its lifecycle behavior:

```text
creation trigger
allowed updates
active condition
exit condition
validation check
failure response
forbidden ownership
```

If a Control record fails its validation check, return to the owning process
state instead of adding a broad summary.

## Process-Local Record Contracts

Record-specific minimum contents live with the process that creates and edits
the record:

```text
Clarity Boundary -> ../clarity/control-records/clarity-boundary.md
Source Inventory -> ../clarity/control-records/source-inventory.md
Context Review Packet -> ../clarity/control-records/context-review-packet.md
Clarity Closure Record -> ../clarity/control-records/clarity-closure-record.md
Discovery plan map -> ../discovery/control-records/plan-map.md
Discovery plan item -> ../discovery/control-records/plan-item.md
selection handoff -> ../discovery/control-records/selection-handoff.md
Work Boundary -> ../delivery/control-records/work-boundary.md
Evidence Packet -> ../delivery/control-records/evidence-packet.md
Landing Packet -> ../delivery/control-records/landing-packet.md
release summary -> ../delivery/control-records/release-summary.md
knowledge promotion decision -> ../delivery/control-records/knowledge-promotion-decision.md
archive decision -> ../delivery/control-records/archive-decision.md
closure record -> ../delivery/control-records/closure-record.md
```

Those pages define what the record must preserve for the process state where
the record is used. This shared page defines the contract mechanics every
record follows.

## Contract Rule

The contract should make future control cheap.

When a field does not apply, write `none` or `not applicable`. Do not omit the
field if the absence would force a future agent to inspect unrelated records
or reconstruct a decision.

A Control record is right-sized when a future agent can continue, prove, land,
close, audit, or archive work without re-deriving the same product judgment or
control decision.
