# Source Inventory

## Purpose

Use a Source Inventory to classify material before Clarity updates Context.

The inventory prevents source-container shape, process history, proof status,
or old taxonomy from silently becoming Context authority.

## Create When

Create or update a Source Inventory when Clarity reads source material,
existing Context, prior Control records, proof context, target facts, or old
structure to support the pass.

## Minimum Contents

Every Source Inventory should preserve:

```text
id
state
owning_clarity_run
context_scope
source_material
current_context_slice
source_treatment
candidate_routes
stale_or_duplicate_candidates
conflict_candidates
canonical_candidates
excluded_material
unresolved_source_questions
```

## Template

```yaml
source_inventory:
  id: ""
  state: "active"
  owning_clarity_run: ""
  context_scope: []
  source_material: []
  current_context_slice: []
  source_treatment:
    authoritative: []
    informative: []
    stale_until_reviewed: []
    source_provenance_only: []
    excluded: []
  candidate_routes: []
  stale_or_duplicate_candidates: []
  conflict_candidates: []
  canonical_candidates: []
  excluded_material: []
  unresolved_source_questions: []
```

## Boundary

The inventory is process state. Durable product meaning belongs in Context
entries after Clarity updates them.
