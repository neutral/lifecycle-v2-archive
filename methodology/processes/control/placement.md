# Control Record Placement and Naming

## Purpose

Use this page when creating persisted Control records in a target repo.

Placement and naming should let an agent find active state without broad
search. Records are stored by process and record type. A shared run id links
records that belong to one bounded process run.

## Placement Rule

Store Control records under `records/control/`.

Use `records/control/discovery/` for Discovery records.

Use `records/control/clarity/` for Clarity records.

Use `records/control/delivery/` for Delivery records.

Use current `records/control/` for the active process's Control records. A
closed process's Control records can be retained in the commit that records the
process and removed from current HEAD before the next independent process
starts.

Do not store Control records in semantic authority storage. Product meaning
that should govern future work belongs in the owning semantic authority
storage. Product judgment for the current Delivery belongs in the Work
Boundary.

## Discovery Placement

Use these locations for Discovery Control records:

```text
records/control/discovery/plans/
records/control/discovery/selections/
```

Use `plans/` for plan maps and plan items.

Use `selections/` for selection handoffs.

## Clarity Placement

Use these locations for Clarity Control records:

```text
records/control/clarity/boundaries/
records/control/clarity/inventories/
records/control/clarity/reviews/
records/control/clarity/closures/
```

Use `boundaries/` for Clarity Boundaries.

Use `inventories/` for Source Inventories.

Use `reviews/` for Context Review Packets.

Use `closures/` for Clarity Closure Records.

## Delivery Placement

Use these locations for Delivery Control records:

```text
records/control/delivery/work-boundaries/
records/control/delivery/evidence/
records/control/delivery/landings/
records/control/delivery/releases/
records/control/delivery/promotions/
records/control/delivery/archives/
records/control/delivery/closures/
```

Use `work-boundaries/` for active and closed Work Boundaries.

Use `evidence/` for Evidence Packets.

Use `landings/` for Landing Packets.

Use `releases/` for release summaries.

Use `promotions/` for knowledge promotion decisions.

Use `archives/` for archive decisions.

Use `closures/` for closure records.

## Naming Rule

Use stable, lowercase, hyphenated names. Avoid spaces.

Use one run id for all Control records that belong to the same Delivery run.
The run id should be short enough to read and specific enough to avoid
collision.

Good run ids:

```text
todo-cli
team-invite-create
dashboard-empty-title
audit-export-retention
```

Avoid names that only describe time:

```text
today
may-25
latest-work
```

Use dates only when they disambiguate otherwise similar runs.

## Discovery Naming

Use these filename shapes:

```text
records/control/discovery/plans/plan-map.<scope>.md
records/control/discovery/plans/plan.<slug>.md
records/control/discovery/selections/selection.<slug>.md
```

The plan map scope can be a product area, repo area, or active planning loop.

The selection slug should match the selected Signal or the plan item slug when
possible.

## Delivery Naming

Use these filename shapes:

```text
records/control/delivery/work-boundaries/wb.<run-id>.md
records/control/delivery/evidence/evidence.<run-id>.<version>.md
records/control/delivery/landings/landing.<run-id>.md
records/control/delivery/releases/release.<run-id>.md
records/control/delivery/promotions/promotion.<run-id>.<slug>.md
records/control/delivery/archives/archive.<run-id>.<slug>.md
records/control/delivery/closures/closure.<run-id>.md
```

## Clarity Naming

Use these filename shapes:

```text
records/control/clarity/boundaries/clarity.<run-id>.md
records/control/clarity/inventories/inventory.<run-id>.md
records/control/clarity/reviews/review.<run-id>.md
records/control/clarity/closures/closure.<run-id>.md
```

Use a run id that names the Context area, cluster, or corpus under review.

Use a commit hash, version, or proof label for the Evidence Packet version
when that makes proof freshness clear.

Examples:

```text
evidence.todo-cli.abc123.md
evidence.todo-cli.uncommitted-local.md
evidence.todo-cli.v2.md
```

## Pointer Rule

Records in the same run should point to each other by record id and path when
the pointer changes future work.

Use these default pointers:

```text
Work Boundary -> selected Signal or selection handoff and semantic/discipline that shaped product judgment
Evidence Packet -> Work Boundary, product judgment coverage, and final work delta
Landing Packet -> Evidence Packet and product judgment coverage
release summary -> Landing Packet and observation plan
knowledge promotion decision -> source product judgment, proof, observation, or Control record
archive decision -> source material and reason not product authority
closure record -> records that closed, stayed active, deferred, or archived
```

Do not copy whole records into pointer fields. Point to the owning record and
preserve only the decision or status needed in the current record.

## Folder Creation Rule

If a target repo does not yet have the needed record folder, create it with a
neutral `overview.md` before creating the first record.

The overview should say what the folder stores. It should not invent process
state, product meaning, proof, or decisions.

## Current State Rule

When a record is moved, renamed, or replaced, update active records that point
to the old name in the same work pass.

Broken pointers make agents read broadly to recover state. Fix the pointer at
the owning record instead of adding a summary.
