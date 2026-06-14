# Context Review Packet

## Purpose

Use a Context Review Packet to track Clarity checks.

The packet records route, content, canonicalization, promotion, and retrieval
evidence for a Context pass. It is not a Delivery Evidence Packet and does not
prove a target work delta.

## Create When

Create or update a Context Review Packet when Clarity will rely on route,
content adequacy, canonicalization, promotion pressure, or retrieval checks.

## Minimum Contents

Every Context Review Packet should preserve:

```text
id
state
owning_clarity_run
context_scope
surface_contract
review_depth
route_checks
content_adequacy_checks
canonicalization_checks
promotion_pressure_checks
retrieval_checks
context_updates
review_freshness_decisions
unresolved_questions
```

## Template

```yaml
context_review_packet:
  id: ""
  state: "active"
  owning_clarity_run: ""
  context_scope: []
  surface_contract: "semantic-authority/surfaces/context.md"
  review_depth: ""
  route_checks: []
  content_adequacy_checks: []
  canonicalization_checks: []
  promotion_pressure_checks: []
  retrieval_checks: []
  relation_checks: []
  context_updates:
    created: []
    updated: []
    moved: []
    superseded: []
    deferred: []
  review_freshness_decisions: []
  unresolved_questions: []
```

## Adequacy Rule

The packet is adequate when a future agent can tell what was checked, what was
not checked, which entries may govern, which entries only orient, and which
follow-up meaning belongs outside Context.
