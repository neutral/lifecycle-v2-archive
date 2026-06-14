# Lifecycle Operational Checks

## Purpose

Use this page to run lightweight checks against a target repo that uses
Lifecycle.

The checks are a harness for agent work. They do not replace judgment, tests,
or proof obligations. They catch missing state, stale handoffs, and authority
boundary mistakes before an agent declares work complete.

Run these commands from the target repo root.

## Folder Checks

Confirm Lifecycle records are versioned and local methodology is not:

```sh
test -d records
test -d records/control
test -d records/context
test -d records/intent
test -d records/assurance
test -d records/blueprint
test -d .lifecycle/methodology
test -d .lifecycle/methodology/local-support
test -d .lifecycle/disciplines
test -f .lifecycle/disciplines/catalog.md
test -d .lifecycle/disciplines/cache
test -d .lifecycle/work-traces
test -d .lifecycle/stop-work-requests
git check-ignore -q .lifecycle/
if git check-ignore -q records/; then
  echo "ERROR: records/ is ignored"
  exit 1
fi
```

Confirm record folders have neutral overviews:

```sh
find records -type d ! -exec test -f '{}/overview.md' ';' -print
```

The command should print nothing.

## Active State Scan

Find active process state:

```sh
rg -n '^\s*state:\s*"?((active)|(blocked)|(deferred))' records/control
rg -n '^\s*state:\s*"?((landing-ready)|(landed))' records/control
```

Use the output to choose Discovery resume, Delivery resume, landing handoff,
runtime and learning handling, or closure.

Review only matches on actual `state` fields. Outcome fields such as
`landing_state` and `landing_or_abandonment_state` do not control resume.

For a newly started independent process, current `records/control/` should
contain only neutral overviews or Control records for that process. Prior
closed process records should be available through commit history after they
were committed, not carried as current active-process material:

```sh
find records/control -type f ! -name overview.md -print
```

Review every output path. If it belongs to a prior closed process, either the
new process was started before resetting Control records or the current work
needs an explicit audit, proof, supersession, or history reference.

## Delivery Readiness Checks

Before Build, confirm the active Work Boundary has the core fields:

```sh
rg -n 'tier|source_signal|selected_meaning|product_judgment|recommendation_basis|admitted_scope' \
  records/control/delivery/work-boundaries
rg -n 'execution_boundary|proof_obligations|freshness_condition' \
  records/control/delivery/work-boundaries
rg -n 'failure_response|semantic_authority_update_obligations' \
  records/control/delivery/work-boundaries
rg -n 'control_record_requirements|landing_readiness' \
  records/control/delivery/work-boundaries
```

When optional tooling is available, verify product judgment and recommendation
basis before Build:

```sh
lt verify judgment --target . --run <run-id>
lt verify basis --target . --run <run-id>
```

Check open stop-work requests before expanding target work:

```sh
find .lifecycle/stop-work-requests -type f -name '*.md' ! -name 'overview.md' -print 2>/dev/null
```

Review any output with
`.lifecycle/methodology/local-support/stop-work-request.md`.

Before landing readiness, confirm proof obligations and commands were captured:

```sh
rg -n 'proof_obligation_id|proof_commands|exact proof' \
  records/control/delivery/evidence
rg -n 'tested_commit|tested commit|local final work delta|runtime' \
  records/control/delivery/evidence
```

Before landing, confirm the Landing Packet points to evidence:

```sh
rg -n 'evidence_packet|Evidence Packet|evidence\.' \
  records/control/delivery/landings
rg -n 'landed_commit|handoff' records/control/delivery/landings
```

Before Delivery complete, confirm closure exists:

```sh
rg -n 'closure|closed|active Work Boundary' records/control/delivery/closures
rg -n 'records_off_by_default|next_retrieval_pointer' \
  records/control/delivery/closures
```

## Discovery Checks

Before selecting work, confirm plan state is explicit:

```sh
rg -n 'state|possible_signal|selection_status|blocker' \
  records/control/discovery/plans
rg -n 'dependency|deferred|selected' records/control/discovery/plans
rg -n 'active_items|blocked_items|deferred_items|selected_items|closed_or_superseded_items' \
  records/control/discovery/maps
```

Before Delivery consumes Discovery context, confirm the selection handoff is
explicit:

```sh
rg -n 'selected_signal|selection_rationale|source_basis' \
  records/control/discovery/selections
rg -n 'known_open_questions|delivery_handoff_target' \
  records/control/discovery/selections
```

Review the matches as live process state. A Selection Handoff that appears
only after Delivery already depended on Discovery context is a Lifecycle
cadence failure. Stop, notify the founder-dev, and repair or restart instead
of treating the handoff as valid closure paperwork.

## Authority Boundary Checks

Confirm semantic authority entries do not point back to process history as if
process history were product authority:

```sh
rg -n 'source_basis|records/control|Clarity Boundary|Context Review Packet|Work Boundary|Evidence Packet' \
  records/context records/intent records/assurance records/blueprint
find . -type f -name '_*.desc.md' \
  ! -path './.git/*' \
  ! -path './.lifecycle/*' \
  -exec rg -n 'source_basis|records/control|Clarity Boundary|Context Review Packet|Work Boundary|Evidence Packet' {} +
rg -n 'Landing Packet|Control record' \
  records/context records/intent records/assurance records/blueprint
find . -type f -name '_*.desc.md' \
  ! -path './.git/*' \
  ! -path './.lifecycle/*' \
  -exec rg -n 'Landing Packet|Control record' {} +
```

Review every match. A product record should not use `source_basis`, proof, or
process history as current authority. Keep source material, admission context,
proof, and transfer evidence in Control records, proof records, archive
decisions, hardening notes, or source-material workspaces.

Confirm Control records do not claim to be product authority:

```sh
rg -n 'product authority|current product truth|governs future product' records/control
```

Review every match and move durable product meaning into semantic authority
when it should govern future work.

Confirm installed discipline is local support, not committed product or
process state:

```sh
test ! -e records/product
test ! -e records/process
test ! -e records/description
test ! -e records/disciplines
test ! -e records/control/disciplines
test ! -e .lifecycle/disciplines/packages
test ! -e .lifecycle/methodology/disciplines/surfaces
test ! -e .lifecycle/methodology/disciplines/bindings
```

When discipline shaped work, confirm Control records preserve the used
material and effect:

```sh
rg -n 'disciplines_used|package id|discipline id' records/control
rg -n 'selected binding|selected slice|used material' records/control
rg -n 'proof effect|promotion candidate' records/control
```

Review every selected package use. A record that stores only a pointer to
`.lifecycle/disciplines/` is incomplete because `.lifecycle/` is ignored
local support.

## Required Check Binding Checks

When semantic authority entries bind Required Checks, confirm the bindings
hold before relying on them as proof support:

```sh
rg -n 'Bound Proof Obligation|Check Command|Environment Requirement|Last Held' \
  records/intent records/assurance
rg -n 'proof_commands|"id"' lifecycle.tools.json
```

Each entry's bound command should exist in the shared tool configuration, the
committed check script it runs should exist, and `last_held` should carry a
date and result without receipt ids. When optional tooling is available,
verify the bindings mechanically:

```sh
lt verify bindings --target .
```

A broken binding makes no claim: repair the entry, the script, or the
registry before treating the check as current proof support. A failing
Required Check is a breach — the entry stays current, landing is blocked for
the entry's scope, and the breach becomes a new Signal.

## Semantic Authority Update Checks

Before closure, confirm semantic authority update obligations have outcomes:

```sh
rg -n 'semantic_authority_update_obligations|satisfied|unnecessary' \
  records/control/delivery/work-boundaries
rg -n 'blocked|deferred|superseded' \
  records/control/delivery/work-boundaries
```

When semantic authority storage changed, confirm entries carry state, scope,
retrieval, related semantic authority, and supersession:

```sh
rg -n 'state|scope|retrieval_keys|target_references' \
  records/context records/intent records/assurance records/blueprint
find . -type f -name '_*.desc.md' \
  ! -path './.git/*' \
  ! -path './.lifecycle/*' \
  -exec rg -n 'state|scope|retrieval_keys|target_references' {} +
rg -n 'related_surfaces|supersedes|superseded_by' \
  records/context records/intent records/assurance records/blueprint
find . -type f -name '_*.desc.md' \
  ! -path './.git/*' \
  ! -path './.lifecycle/*' \
  -exec rg -n 'related_surfaces|supersedes|superseded_by' {} +
```

Review changed semantic authority entries with
`.lifecycle/methodology/semantic-authority/semantic-authority-surface-registry.yaml`,
`.lifecycle/methodology/semantic-authority/update-product-meaning.md`, and the
owning surface contract under
`.lifecycle/methodology/semantic-authority/surfaces/`. Those files own
entry adequacy, semantic authority backpressure, dependency routing, and
semantic authority update outcomes.

When runtime construction matters, confirm the Evidence Packet names the
construction, startup, load, or invocation proof that the Delivery gates
require.

## Discipline Checks

When installed discipline is present, confirm the catalog, package info,
bindings, and generated surface content are discoverable:

```sh
test -f .lifecycle/disciplines/catalog.md
test -d .lifecycle/disciplines/package-info
test -d .lifecycle/disciplines/bindings
test -d .lifecycle/disciplines/surfaces
rg -n 'Installed Discipline Packages|Use this installed catalog' .lifecycle/disciplines/catalog.md
```

When a package binding is selected, review the active Work Boundary with
`.lifecycle/methodology/disciplines/use-discipline.md` and
`.lifecycle/methodology/disciplines/checks/usage-adequacy.md`.

Before Build, selected discipline should be recorded as adopted,
rejected, conflicted, or assumed, including its product judgment effect when it
shaped admission. Before Proof, discipline obligations should have
evidence. Before Closure, promotion candidates should be promoted, rejected,
archived, deferred, or marked unnecessary.

## Generated Artifact Checks

Before landing, inspect generated local artifacts that should not land:

```sh
git status --short --ignored
```

Ignore or remove generated local artifacts before landing unless admitted scope
and product judgment in the active Work Boundary include them.

When optional tooling support exists, confirm it remains ignored local support:

```sh
if test -e .lifecycle/tooling; then
  git check-ignore -q .lifecycle/tooling || {
    echo "ERROR: .lifecycle/tooling should be ignored local support"
    exit 1
  }
fi
```

Confirm generated tooling support has a registry and lock when present:

```sh
if test -e .lifecycle/tooling; then
  test -f .lifecycle/tooling/support/contract-registry.json
  test -f .lifecycle/tooling/tooling.lock.json
fi
```

Tool findings, proof receipts, indexes, and prepared material should not appear
as raw durable records. If they affect work state, record the interpreted effect
in the owning Clarity Boundary, Context Review Packet, Work Boundary, Evidence
Packet, Landing Packet, closure record, or semantic authority entry. Judgment
effects belong in the active Work Boundary.

## Git Delta Checks

Before Evidence and Reconciliation, inspect the final work delta:

```sh
git status --short
git diff --stat
git diff --name-only
```

Compare the output to the active Work Boundary's product judgment, admitted
scope, allowed change surfaces, restricted change surfaces, and declared
non-changes.

## Check Response

When a check fails:

```text
1. Stop the current transition.
2. Identify the owning record.
3. Update the missing field, state, pointer, proof, or obligation.
4. Rerun the check.
5. Continue only when the active state is clear.
```

Do not hide check failures in broad summaries. Fix the smallest record that
restores control.
