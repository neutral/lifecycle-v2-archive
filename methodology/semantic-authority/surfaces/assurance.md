# Assurance surface

## Purpose

The Assurance surface captures non-functional and invariant obligations.

Use [contract.md](contract.md) for shared semantic authority entry
state, related semantic authority, update rules, and promotion paths.

It answers:

```text
What must remain true?
```

Assurances may be global, feature-local, module-local, or release-specific.
Their scope defines where the obligation applies.

Assurances belong in the Assurance surface. Intent may reference Assurance IDs,
but Intent does not own Assurance content. Intent defines product behavior.
Assurance defines what must remain true while that behavior is implemented,
proved, released, and observed.

## Typical contents

Assurances may cover:

- tenant isolation
- data privacy
- authorization correctness
- billing invariants
- latency budgets
- idempotency
- accessibility
- email deliverability
- rollback readiness
- auditability

A good assurance has:

- scope
- statement
- rationale
- assurance checks
- linked semantic authority IDs
- linked code change surfaces
- proof expectations
- freshness basis

Assurance entries keep the standard semantic authority YAML header. Their
Markdown body may use different body shapes for invariants, operational
obligations, risk or data constraints, and required checks. Use only the shape
needed for the durable obligation; do not create separate Assurance schemas for
those shapes.

Assurances matter because agents can satisfy functional behavior while
violating invisible constraints.

## Contract focus

Assurance entries should expose:

```text
primary question: what must remain true
owned meaning: obligations, invariants, risk constraints, and required checks
common references: linked Intent, Blueprint, Description, and target surfaces
```

Update Assurance when an invariant, obligation, risk constraint, or required
check should govern future work. Keep one-run proof status in Evidence Packets.

A required check may be executable: bind it as a Required Check using the
Required Checks section of [contract.md](contract.md). A bound check would
catch a violation of what must remain true; its failure is a breach — the
entry stays current, landing is blocked for the entry's scope, and the breach
becomes a new Signal.

## Homes

Assurances should live in the Assurance surface.

The Assurance surface may contain:

- global Assurance entries for cross-cutting rules
- feature-local Assurance entries for feature-specific obligations
- module-local Assurance entries for implementation-local invariants
- release-specific Assurance entries for release constraints

Each Assurance entry is canonical for its scope. Other semantic authority
entries link to Assurance IDs rather than restating the obligation.

## Example

```yaml
assurance:
  id: "assurance.team-invites.no-seat-allocation-on-create"
  surface: "assurance"
  state: "current"
  scope: "feature"
  current_meaning: "Creating a pending invite must not allocate a billable seat."
  retrieval_keys:
    - "product_area:teams"
    - "obligation:no-seat-allocation-on-invite-create"
    - "risk:billing"
  target_references:
    - "team invite service"
    - "billing seat accounting"
  statement: "Creating a pending invite must not allocate a billable seat."
  rationale: "Seat accounting starts at membership activation, not invite creation."
  related_surfaces:
    - "intent.team-invites.create"
    - "description.team-invite-service"
  assurance_checks:
    - "Creating a pending invite does not increase active seat count."
    - "Billing areas are not touched by invite creation."
  evidence_required:
    - "no_billing_area_changed"
    - "seat_count_unchanged_after_invite_create"
  supersedes: []
  superseded_by: ""
  updated_at: "YYYY-MM-DD"
```
