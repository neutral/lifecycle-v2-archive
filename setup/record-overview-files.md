# Record overview files

## Purpose

Use this page to seed neutral `overview.md` files in a target codebase.

Overview files explain folder purpose. They should not invent product meaning,
plans, Work Boundaries, evidence, or process decisions during setup.

## Required Root Overviews

Use this for `records/overview.md`:

```markdown
# Records

This folder stores committed Lifecycle records for this codebase.

Context, Intent, Assurance, and Blueprint semantic authority entries live in
their `records/` folders. Description semantic authority files live beside
described source files as `_*.desc.md`.
Persisted Control records live in `control/`.

Historical Control records may be retained in prior commits while current
`records/control/` is reset for a new process.
```

Use this for `records/control/overview.md`:

```markdown
# Control Records

This folder stores persisted Control records for Lifecycle processes.

Use these records for the current Clarity, Discovery, or Delivery process
state.
Processes own their Control records independently. After a closed process has
been committed for history, start the next process from a fresh Control-record
area and rely on semantic authority for durable product continuity.
```

Use this for `records/control/clarity/overview.md`:

```markdown
# Clarity Control Records

This folder stores persisted Clarity Control records.

Use these records for the current Clarity process: Clarity Boundaries, Source
Inventories, Context Review Packets, and Clarity Closure Records.
```

Use this for `records/control/discovery/overview.md`:

```markdown
# Discovery Control Records

This folder stores persisted Discovery Control records.

Use these records for the current Discovery process: plans, plan maps, plan
items, and selection handoffs.
```

Use this for `records/control/delivery/overview.md`:

```markdown
# Delivery Control Records

This folder stores persisted Delivery Control records.

Use these records for the current Delivery process: Work Boundaries, Evidence
Packets, Landing Packets, release summaries, knowledge promotion decisions,
archive decisions, and closure records.
```

## Leaf Folder Purposes

Use one-sentence leaf overviews.

Use these folder purposes:

```text
records/context/
  Context entries for product meaning, users, market, strategy, direction, and
  broad product-context atlas organization.

records/intent/
  Intent entries for intended behavior, acceptance checks, and non-goals.

records/assurance/
  Assurance entries for invariants, obligations, and constraints.

records/blueprint/
  Blueprint entries for structure, sequence, state, and dependency shape.

records/control/discovery/plans/
  Discovery plan items.

records/control/discovery/maps/
  Discovery plan maps.

records/control/discovery/selections/
  Discovery selection handoffs.

records/control/clarity/boundaries/
  Clarity Boundaries.

records/control/clarity/inventories/
  Clarity Source Inventories.

records/control/clarity/reviews/
  Clarity Context Review Packets.

records/control/clarity/closures/
  Clarity Closure Records.

records/control/delivery/work-boundaries/
  Delivery Work Boundaries, including product judgment for active Delivery.

records/control/delivery/evidence/
  Evidence Packets and proof records.

records/control/delivery/landings/
  Landing Packets and release or merge handoffs.

records/control/delivery/releases/
  Release summaries.

records/control/delivery/promotions/
  Knowledge promotion decisions.

records/control/delivery/archives/
  Archive decisions.

records/control/delivery/closures/
  Delivery closure records.
```

## Examples

Example `records/context/overview.md`:

```markdown
# Context

This folder stores Context entries for product meaning, users, market,
strategy, direction, and broad product-context atlas organization.

Use .lifecycle/methodology/semantic-authority/templates/context-entry.md when creating
an entry. Retrieve entries by stable ID, state, scope, retrieval keys, target
references, related semantic authority, and Context atlas route when the
corpus is broad.

Broad Context may be organized into product-area and cluster subfolders. Use
neutral overview.md files for folder purpose. Use current Context entries for
area overviews, canonical references, rationale leaves, semantic neighborhoods,
freshness policy, and promotion pressure.

When broad Context is reorganized, keep route review separate from leaf
content review; moving an entry into a better atlas path does not mark the
entry's owned meaning reviewed.

Use Clarity when broad Context maintenance, canonicalization, review-label
correction, promotion-pressure review, or retrieval repair is the work. Context
entries store product meaning; Clarity records store the review operation.
```

Example `records/control/delivery/work-boundaries/overview.md`:

```markdown
# Work Boundaries

This folder stores Delivery Work Boundaries.

Work Boundaries preserve product judgment and process-local Delivery scope.
They do not become durable product authority after closure.
```
