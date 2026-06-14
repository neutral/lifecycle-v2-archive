# Clarity Package Manifest

## Purpose

Use this page as the human-readable compiler manifest for the Clarity process
package.

## Package

| Field | Value |
| --- | --- |
| package type | process |
| id | clarity |
| name | Clarity |
| version | 0.1.0 |
| source root | methodology/processes/clarity |
| record root | records/control/clarity |

## Entry Conditions

- Context pressure exists
- active Clarity Control record exists
- founder-dev asks a broad product, rationale, strategy, or meaning question
- Context corpus route, review status, freshness, canonicalization, or
  promotion pressure needs focused work
- Discovery or Delivery is blocked by missing Context meaning

## States

- clarity-active

## Installed Source Pages

| id | source | install path |
| --- | --- | --- |
| overview | overview.md | processes/clarity/overview.md |
| process | process.md | processes/clarity/process.md |
| gates | gates.md | processes/clarity/gates.md |
| phase-intake | phases/intake.md | processes/clarity/phases/intake.md |
| phase-source-inventory | phases/source-inventory.md | processes/clarity/phases/source-inventory.md |
| phase-atlas-routing | phases/atlas-routing.md | processes/clarity/phases/atlas-routing.md |
| phase-content-adequacy | phases/content-adequacy.md | processes/clarity/phases/content-adequacy.md |
| phase-canonicalization | phases/canonicalization.md | processes/clarity/phases/canonicalization.md |
| phase-promotion-pressure | phases/promotion-pressure.md | processes/clarity/phases/promotion-pressure.md |
| phase-retrieval-proof | phases/retrieval-proof.md | processes/clarity/phases/retrieval-proof.md |
| phase-closure | phases/closure.md | processes/clarity/phases/closure.md |
| control-records-overview | control-records/overview.md | processes/clarity/control-records/overview.md |
| control-record-clarity-boundary | control-records/clarity-boundary.md | processes/clarity/control-records/clarity-boundary.md |
| control-record-source-inventory | control-records/source-inventory.md | processes/clarity/control-records/source-inventory.md |
| control-record-context-review-packet | control-records/context-review-packet.md | processes/clarity/control-records/context-review-packet.md |
| control-record-clarity-closure-record | control-records/clarity-closure-record.md | processes/clarity/control-records/clarity-closure-record.md |

## Records

| id | source | install path | record root | contract source |
| --- | --- | --- | --- | --- |
| clarity-boundary | control-records/clarity-boundary.md | control-records/clarity-boundary.md | records/control/clarity/boundaries | control-records/clarity-boundary.contract.json |
| source-inventory | control-records/source-inventory.md | control-records/source-inventory.md | records/control/clarity/inventories | control-records/source-inventory.contract.json |
| context-review-packet | control-records/context-review-packet.md | control-records/context-review-packet.md | records/control/clarity/reviews | control-records/context-review-packet.contract.json |
| clarity-closure-record | control-records/clarity-closure-record.md | control-records/clarity-closure-record.md | records/control/clarity/closures | control-records/clarity-closure-record.contract.json |

## Handoffs Out

- recommendations

## Required Semantic Authority Operations

- retrieve-product-meaning
- update-product-meaning
- resolve-semantic-authority-backpressure
