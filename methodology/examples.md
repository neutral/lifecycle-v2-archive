# Lifecycle Operational Examples

## Purpose

Use these examples to calibrate how much Lifecycle recordkeeping is enough.

The examples show the file reads, product judgment, records, proof, and closure
shape for common target-repo work. They are not templates. Use the contracts
and process gates when the target repo needs more precision.

## Compact Typo Fix Delivery

Prompt:

```text
Fix the typo in the empty dashboard title.
```

Read:

```text
start.md
route.md
states/signal-interpreting.md
states/work-boundary-active.md
```

Create:

```text
records/control/delivery/work-boundaries/wb.dashboard-empty-title.md
```

Keep the Work Boundary compact:

```text
state: active
tier: compact
selected meaning: correct spelling in existing title
product judgment: accept only the spelling correction now because the inspected
  title source shows a text typo; exclude layout, copy rewrite, empty-state
  behavior, and product positioning; falsifier is evidence that the title is a
  reused product promise or behavior label
recommendation basis: inspected title source and nearby copy; high confidence
  this is text-only; falsifier is reused product promise or behavior
admitted scope: text-only title fix
declared non-changes: no layout or behavior change
execution boundary: local file edit and local check
proof obligations: title renders with corrected spelling
semantic authority update obligations: none
```

Proof:

```text
local text check or render check
```

Create:

```text
records/control/delivery/evidence/evidence.dashboard-empty-title.<version>.md
records/control/delivery/landings/landing.dashboard-empty-title.md
records/control/delivery/closures/closure.dashboard-empty-title.md
```

Close when proof is current, product judgment coverage is present, no product
meaning changed, and the Work Boundary is closed.

## Small Bug Fix Delivery

Prompt:

```text
Completed todos disappear after reopening the CLI.
```

Read:

```text
start.md
route.md
states/signal-interpreting.md
semantic-authority/semantic-authority-surface-registry.yaml
```

Create a Standard or Compact Work Boundary depending on product risk.

Use Compact when the bug clearly violates existing admitted behavior:

```text
selected meaning: completed todos remain stored and visible after reload
product judgment: accept persistence repair because current behavior contradicts
  admitted todo completion meaning; exclude storage migration and new commands;
  falsifier is evidence that completion was intentionally session-only
recommendation basis: inspected current persistence behavior, storage module,
  tests, and product authority; confidence matches ambiguity
declared non-changes: no storage format migration, no new commands
allowed surfaces: todo storage module and tests
proof obligations:
  - completed todo persists after reload
  - existing add/list behavior still works
semantic authority update obligations:
  - Intent none when existing Intent already covers persistence
  - Description update when local storage responsibility changes
```

Proof:

```text
exact test command
manual CLI smoke command when needed
```

When an Assurance entry already governs the violated behavior — here,
completed-state persistence — this bug is the moment to give it teeth. Bind a
Required Check on the entry through the surface update procedure:

```text
Bound Proof Obligation: proof.completed-state-persists
Check Command: check-completed-state-persists   (registered proof command)
Environment Requirement: none, local files only
Last Held: <date> — passed
```

The check script is committed, registered in the shared tool configuration,
and proven able to fail (seed the regression once before trusting the pass).
Future deliveries that touch storage satisfy this proof obligation by
re-running the standing check instead of re-deriving proof, and a red check
between runs is a breach: the entry stays current and the breach becomes a new
Signal.

When proof runs before the final commit exists, the Evidence Packet can name
the tested local final work delta. The Landing Packet can later say that the
work landed in the same commit as the Landing Packet.

Before closure, update Description only if local implementation responsibility
changed. Do not create Context or Blueprint just because the code changed.

## New Product Area Delivery

Prompt:

```text
Create a small CLI todo tracker.
```

Start Delivery because the prompt is a concrete Signal.

Create:

```text
records/control/delivery/work-boundaries/wb.todo-cli.md
records/control/delivery/evidence/evidence.todo-cli.1.md
```

The Evidence Packet starts live during Framing, before Build, and carries proof
results as they appear.

Use the new product area path:

```text
selected meaning: user can add, list, and complete local todos
product judgment: accept a minimal local CLI behavior set now because the Signal
  asks for a usable tracker; choose local persistence over accounts,
  collaboration, sync, or prioritization; falsifier is existing authority that
  requires a different product surface
recommendation basis: inventory existing CLI/product authority and target
  surfaces before choosing scope; state assumptions, confidence, falsifiers,
  and behavior that must not be collapsed
semantic authority slice: new or not yet present
semantic authority update obligations:
  - Intent for CLI todo behavior
  - Assurance for local persistence invariant when needed
  - Description for local module responsibility when future edits need it
```

Build and prove first. Then create only the semantic authority entries future
work needs:

```text
records/intent/intent.todo-cli.md
records/assurance/assurance.local-storage.md
src/todo/_module.desc.md
```

Skip Context when no durable product rationale is needed. Skip Blueprint when
there is no structure, state flow, dependency direction, or shared boundary
that future work needs to preserve.

Close only after the Work Boundary update obligations say which entries were
created, skipped as unnecessary, deferred, or blocked. State each skip
explicitly — an Assurance or Context entry left implicit reads as forgotten,
not skipped.

## Discovery Selection Into Delivery

Prompt:

```text
Look at the repo and decide what we should do next.
```

Start Discovery.

Read:

```text
start.md
route.md
states/discovery-active.md
```

Create or update:

```text
records/control/discovery/plans/plan-map.product.md
records/control/discovery/plans/plan.audit-export.md
```

When the founder-dev selects a candidate, create:

```text
records/control/discovery/selections/selection.audit-export-retention.md
```

The selection handoff should preserve:

```text
selected Signal
selection rationale
source basis
known open questions
blockers or dependencies that shape admission
```

Delivery starts from the selected Signal. Delivery still creates an active
Work Boundary with product judgment before Build.

## Resume Active Delivery

Start with active records:

```text
records/control/delivery/work-boundaries/wb.team-invite-create.md
records/control/delivery/evidence/evidence.team-invite-create.uncommitted-local.md
```

Use the invocation protocol:

```text
1. Read the active Work Boundary.
2. Confirm product judgment still matches the current delta.
3. Identify the Delivery state.
4. If evidence exists but proof is stale, resume at Evidence Produced.
5. Refresh proof against the final work delta and product judgment coverage.
6. Update the Evidence Packet state.
7. Continue to Landing Packet only when proof, product judgment coverage, and
   reconciliation are current.
```

Do not start a new Work Boundary unless the existing Work Boundary no longer
admits the work or its product judgment is falsified.

## Abandon Delivery

Abandon a Delivery run when the selected meaning is wrong, unsafe, superseded,
or no longer worth landing.

Update:

```text
records/control/delivery/work-boundaries/wb.<run-id>.md
records/control/delivery/closures/closure.<run-id>.md
```

The closure record should state:

```text
outcome: abandoned
reason
records closed
records archived
records left active, blocked, or deferred
product judgment outcome
semantic authority updates not made
next retrieval pointer when follow-up remains
```

Do not leave the Work Boundary active after abandonment.

## Close Discovery With No Selected Signal

Discovery can close without selecting work.

Use this path when:

```text
no useful candidate is ready
candidates are deferred or blocked
the founder-dev asks to stop
the plan map is refreshed and no Delivery should start
```

Update:

```text
records/control/discovery/plans/plan-map.<scope>.md
records/control/discovery/plans/plan.<slug>.md
```

Closure is recorded in the plan map or the owning plan item. The Discovery
record should make clear whether attention is closed, blocked, deferred, or
left active.

Do not create a Delivery Work Boundary unless a concrete Signal is selected.
