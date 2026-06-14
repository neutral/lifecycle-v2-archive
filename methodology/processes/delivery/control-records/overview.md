# Delivery Control Records

## Purpose

Use this folder for the Control records Delivery creates, reads, updates, and
closes.

Delivery Control records preserve product judgment, admission, admitted scope,
execution boundary, obligations, discipline usage, proof status, handoffs,
release exposure, closure state, and knowledge promotion or archive decisions
for one Delivery run.

Delivery Control records are process-local. A later independent process may
read them for handoff, proof, audit, supersession, or history, but it should
not share their mutable state. After a closed Delivery run is committed, start
the next independent process from fresh current Control records.

Delivery Control records are live process state. They are not a form to fill in
after the work is already done. The active Work Boundary authorizes
substantive repository edits. The Evidence Packet tracks proof obligations,
proof execution, freshness, and reconciliation while the run proceeds. Landing
and closure records finish a run; they cannot repair a missing live Work
Boundary or Evidence cadence.

Use [../../control/overview.md](../../control/overview.md) for shared control
mechanics.

## Records

Delivery uses these Control records:

```text
Work Boundary
Evidence Packet
Landing Packet
release summary
knowledge promotion decision
archive decision
closure record
```

Use [work-boundary.md](work-boundary.md) for the active Work Boundary record that
records the product judgment, admits work, and includes selected discipline
when it materially shapes the run.

Use [evidence-packet.md](evidence-packet.md) for proof status against the
final work delta and admitted product judgment, including discipline proof
obligations.

Use [landing-packet.md](landing-packet.md) for merge or release handoff after
product judgment coverage is current.

Use [release-summary.md](release-summary.md) for release exposure and runtime
observation context.

Use [knowledge-promotion-decision.md](knowledge-promotion-decision.md) when
learning may become durable product authority.

Use [archive-decision.md](archive-decision.md) when material remains useful
history but should not become current product authority.

Use [closure-record.md](closure-record.md) to close the Delivery run and record
whether product judgment was satisfied, superseded, abandoned, or promoted into
durable authority.

Use [../../control/contracts.md](../../control/contracts.md) for universal
Control record contract mechanics. The pages in this folder own the
record-specific minimum contents and templates for Delivery records.

## Agent Path

When running Delivery, use this path:

```text
1. Use the Signal phase to interpret the selected Signal.
2. State product judgment and create or confirm the Work Boundary during
   Framing.
3. Create or update an active Evidence Packet once proof obligations are
   concrete and before substantive Build edits.
4. Build only inside the active Work Boundary while keeping Evidence current.
5. Update the Evidence Packet during proof and reconciliation, including
   product judgment coverage.
6. Produce a Landing Packet when the work is landing ready.
7. Produce release, promotion, archive, and closure records during Release and
   Learning when they apply.
8. Update Control record state and related-record pointers when state changes.
```

Substantive edits include product authority, target code, tests, setup, tools,
Lifecycle source or methodology, notes-map strategy, package/config files, and
generated installed output that will be relied on.

If substantive edits happen before the active Work Boundary and Evidence
cadence exist, stop normal work and notify the founder-dev immediately. Do not
write end-of-run records that imply Lifecycle controlled work it did not
actually control.

Use shared control rules only for mechanics:

```text
state -> ../../control/states.md
retrieval -> ../../control/retrieval.md
contract -> ../../control/contracts.md
closure -> ../../control/closure.md
checks -> ../../control/checks.md
universal template header -> ../../control/templates.md
```

## Relationship To Lifecycle Roles

Control records sit beside semantic authority, target, proof, and observation.
They do not replace Context, Intent, Assurance, Blueprint, or Description as
current semantic authority. Product judgment inside a Work Boundary is
process-local weighing between authority and action; it does not become durable
product authority unless promoted through semantic authority update rules.

An Evidence Packet preserves proof while still acting as a Control record for a
Delivery run. A Landing Packet has release or merge handoff authority for one
landing. Neither record becomes durable product authority by itself.

Control records are not part of the work delta they describe or prove. An
Evidence Packet proves the work delta. A Landing Packet records that the work
delta was reconciled and ready to land.

## Delivery Record Placement

A target repo stores Delivery Control records by record type. The shared
Delivery run id links the records that belong to one bounded run.

Example:

```text
records/control/delivery/work-boundaries/wb.team-invite-create.md
records/control/delivery/evidence/evidence.team-invite-create.abc123.md
records/control/delivery/landings/landing.team-invite-create.md
records/control/delivery/closures/closure.team-invite-create.md
```

Read the shape this way:

```text
Work Boundary: product judgment, permission, admitted scope, and execution boundary
Evidence Packet: proof for the final work delta and admitted product judgment
Landing Packet: release or merge handoff with judgment coverage pointer
closure record: Delivery closure, product judgment outcome, learning, archive, and remaining state
```

Evidence and landing happen under the authority of the active Work Boundary.
They are sibling Control records linked by Delivery run id, not nested parts of
the Work Boundary object.

After the Delivery run closes, the Work Boundary remains a Control record scoped
to that Delivery run. The Landing Packet preserves handoff authority for that
landing. Neither record, and no closed product judgment inside it, replaces
semantic authority surfaces as durable product authority.
