# Landing Packet

## Purpose

Use a Landing Packet to preserve release or merge handoff state.

The Landing Packet records that the final work delta was reconciled, proved,
and ready for the landing action, including coverage of the admitted product
judgment. It points to evidence instead of repeating it.

## When To Use

Create a Landing Packet when Delivery reaches landing readiness.

Use it to preserve:

```text
work delta summary
Evidence Packet pointer
product judgment coverage pointer
landing decision
release or merge handoff details
landed commit, version, or handoff reference when known
runtime exposure, when relevant
discipline proof status pointer, when selected package affected landing readiness
rollback, observation, or follow-up pointer when relevant
```

## Minimum Contents

A Landing Packet preserves:

```text
record id
record state
owning Delivery run
work delta summary
Evidence Packet pointer
product judgment coverage pointer
landing decision
release or merge handoff details
landed commit, version, or handoff reference when known
runtime exposure, when relevant
discipline proof status pointer, when selected package affected landing readiness
rollback, observation, or follow-up pointer when relevant
```

## Lifecycle

Create a Landing Packet when work is landing ready.

Update it when the landing decision, handoff, landed commit, runtime exposure,
rollback pointer, observation pointer, or follow-up pointer changes.

The Landing Packet is active or `landing-ready` while handoff is pending. It
exits active state when merge, release, or abandonment handoff occurs.

Validation check:

```text
Evidence Packet is current, product judgment coverage is present, and handoff
is explicit
```

Forbidden ownership:

```text
admitted behavior
proof details
durable product authority
```

## Template

```yaml
landing_packet:
  id: ""
  state: "landing-ready"
  owning_delivery_run: ""
  work_delta_summary: ""
  evidence_packet: ""
  product_judgment_coverage: ""
  landing_decision: ""
  landing_state: ""
  release_or_merge_handoff: []
  landed_commit_version_or_handoff: ""
  runtime_exposure: "none"
  discipline_proof_status: "not applicable"
  rollback_observation_or_follow_up: []
```

## Boundary

A Landing Packet has handoff authority for one landing. It does not define
product meaning and does not replace the active Work Boundary, Evidence Packet,
or semantic authority surfaces.

Prepared landing material from tooling is draft material. The agent owns the
landing decision, handoff wording, runtime exposure treatment, and any carried
forward blocker or follow-up.

After landing, use Release and Learning to resolve observation handling,
knowledge promotion, archive decisions, and Delivery closure.
