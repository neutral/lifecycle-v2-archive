# Discovery Package Manifest

## Purpose

Use this page as the human-readable compiler manifest for the Discovery process
package.

## Package

| Field | Value |
| --- | --- |
| package type | process |
| id | discovery |
| name | Discovery |
| version | 0.1.0 |
| source root | methodology/processes/discovery |
| record root | records/control/discovery |

## Entry Conditions

- next useful work is unclear
- Discovery records are active
- founder-dev asks what should happen next

## States

- discovery-active

## Installed Source Pages

| id | source | install path |
| --- | --- | --- |
| overview | overview.md | processes/discovery/overview.md |
| process | process.md | processes/discovery/process.md |
| gates | gates.md | processes/discovery/gates.md |
| control-records-overview | control-records/overview.md | processes/discovery/control-records/overview.md |
| control-record-plan-map | control-records/plan-map.md | processes/discovery/control-records/plan-map.md |
| control-record-plan-item | control-records/plan-item.md | processes/discovery/control-records/plan-item.md |
| control-record-selection-handoff | control-records/selection-handoff.md | processes/discovery/control-records/selection-handoff.md |

## Records

| id | source | install path | record root | contract source |
| --- | --- | --- | --- | --- |
| plan-map | control-records/plan-map.md | control-records/plan-map.md | records/control/discovery/maps | control-records/plan-map.contract.json |
| plan-item | control-records/plan-item.md | control-records/plan-item.md | records/control/discovery/plans | control-records/plan-item.contract.json |
| selection-handoff | control-records/selection-handoff.md | control-records/selection-handoff.md | records/control/discovery/selections | control-records/selection-handoff.contract.json |

## Handoffs Out

- selected-signal

## Required Semantic Authority Operations

- retrieve-product-meaning
- resolve-semantic-authority-backpressure
