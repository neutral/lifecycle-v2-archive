# Delivery Package Manifest

## Purpose

Use this page as the human-readable compiler manifest for the Delivery process
package.

## Package

| Field | Value |
| --- | --- |
| package type | process |
| id | delivery |
| name | Delivery |
| version | 0.1.0 |
| source root | methodology/processes/delivery |
| record root | records/control/delivery |

## Entry Conditions

- concrete Signal exists
- selected Signal handoff exists
- active Delivery Control record exists
- product judgment can be stated before Build when Delivery is past Signal
  interpretation

## States

- signal-interpreting
- work-boundary-active
- build-active
- proof-active
- landing-ready
- landed
- release-learning-active
- closure-active

## Installed Source Pages

| id | source | install path |
| --- | --- | --- |
| overview | overview.md | processes/delivery/overview.md |
| process | process.md | processes/delivery/process.md |
| gates | gates.md | processes/delivery/gates.md |
| phase-signal | phases/signal.md | processes/delivery/phases/signal.md |
| phase-framing | phases/framing.md | processes/delivery/phases/framing.md |
| phase-build | phases/build.md | processes/delivery/phases/build.md |
| phase-evidence-and-reconciliation | phases/evidence-and-reconciliation.md | processes/delivery/phases/evidence-and-reconciliation.md |
| phase-release-and-learning | phases/release-and-learning.md | processes/delivery/phases/release-and-learning.md |
| control-records-overview | control-records/overview.md | processes/delivery/control-records/overview.md |
| control-record-work-boundary | control-records/work-boundary.md | processes/delivery/control-records/work-boundary.md |
| control-record-evidence-packet | control-records/evidence-packet.md | processes/delivery/control-records/evidence-packet.md |
| control-record-landing-packet | control-records/landing-packet.md | processes/delivery/control-records/landing-packet.md |
| control-record-release-summary | control-records/release-summary.md | processes/delivery/control-records/release-summary.md |
| control-record-knowledge-promotion-decision | control-records/knowledge-promotion-decision.md | processes/delivery/control-records/knowledge-promotion-decision.md |
| control-record-archive-decision | control-records/archive-decision.md | processes/delivery/control-records/archive-decision.md |
| control-record-closure-record | control-records/closure-record.md | processes/delivery/control-records/closure-record.md |

## Records

| id | source | install path | record root | contract source |
| --- | --- | --- | --- | --- |
| work-boundary | control-records/work-boundary.md | control-records/work-boundary.md | records/control/delivery/work-boundaries | control-records/work-boundary.contract.json |
| evidence-packet | control-records/evidence-packet.md | control-records/evidence-packet.md | records/control/delivery/evidence | control-records/evidence-packet.contract.json |
| landing-packet | control-records/landing-packet.md | control-records/landing-packet.md | records/control/delivery/landings | control-records/landing-packet.contract.json |
| release-summary | control-records/release-summary.md | control-records/release-summary.md | records/control/delivery/releases | control-records/release-summary.contract.json |
| knowledge-promotion-decision | control-records/knowledge-promotion-decision.md | control-records/knowledge-promotion-decision.md | records/control/delivery/promotions | control-records/knowledge-promotion-decision.contract.json |
| archive-decision | control-records/archive-decision.md | control-records/archive-decision.md | records/control/delivery/archives | control-records/archive-decision.contract.json |
| closure-record | control-records/closure-record.md | control-records/closure-record.md | records/control/delivery/closures | control-records/closure-record.contract.json |

## Handoffs In

- selected-signal

## Handoffs Out

- closure

## Required Semantic Authority Operations

- retrieve-product-meaning
- update-product-meaning
- resolve-semantic-authority-backpressure
