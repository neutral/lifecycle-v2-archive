# Control record templates

## Purpose

Use this page for shared template rules that apply to persisted Control
records.

Process-local templates live with the record pages agents edit during
Clarity, Discovery, or Delivery:

```text
../clarity/control-records/
../discovery/control-records/
../delivery/control-records/
```

Use this page when a record needs the shared header shape or the compact
template rule.

## Universal Header

Use this header shape unless a record is intentionally inline and compact:

```yaml
record:
  id: ""
  type: ""
  state: "active"
  owning_process: ""
  owning_run: ""
  scope: []
  authority_treatment: "record process state"
  context_eligibility: ""
  related_records: []
```

The header exposes identity, state, ownership, scope, authority treatment, and
related records for both manual inspection and optional generated checks.

Do not add cache fields, generated support fields, raw finding fields, or tool
index fields to the universal header. Tool observations belong in a process
record only after an agent records their interpreted effect under the field
owned by that record type.

## Process-Local Templates

Use the process-local record page for the template that matches the record
being created:

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

## Template Rule

Start compact. Add detail only when it changes future action, proof,
reconciliation, product judgment, handoff, closure, promotion, archive, or
retrieval.

Do not create a broad template because a record is important. A record is
right-sized when it preserves the control state future work needs without
making unrelated history active by default.
