# Clarity Boundary

## Purpose

Use a Clarity Boundary to admit one bounded Context pass.

The boundary controls what Context the agent may update, which review depth is
intended, and what must remain outside the pass.

## Create When

Create a Clarity Boundary before substantive Context edits in a Clarity run.

## Minimum Contents

Every Clarity Boundary should preserve:

```text
id
state
owning_clarity_run
context_scope
selected_questions
review_depth
source_material_policy
allowed_context_mutations
explicit_exclusions
semantic_authority_boundaries
required_review_checks
retrieval_proof_obligations
closure_condition
no_auto_start_rule
```

## Template

```yaml
clarity_boundary:
  id: ""
  state: "active"
  owning_clarity_run: ""
  context_scope:
    areas: []
    clusters: []
    entries: []
  selected_questions: []
  review_depth: "route-only | cluster-review | canonicalization | promotion-review | context-authority"
  source_material_policy:
    authoritative: []
    informative: []
    stale_until_reviewed: []
    excluded: []
  allowed_context_mutations:
    - "create/update Context entries inside scope"
    - "update Context atlas metadata inside scope"
  explicit_exclusions:
    - "No target code changes."
    - "No automatic Discovery or Delivery start."
  semantic_authority_boundaries:
    may_update:
      - "context"
    may_record_pressure_for:
      - "intent"
      - "assurance"
      - "blueprint"
      - "description"
    must_not_update_without_explicit_extension:
      - "intent"
      - "assurance"
      - "blueprint"
      - "description"
  required_review_checks: []
  retrieval_proof_obligations: []
  closure_condition: ""
  no_auto_start_rule: "Clarity closes with recommendations only; founder-dev decides the next process."
```

## Failure Response

If the boundary is too broad, narrow the scope or close blocked. Do not continue
by treating the whole corpus as implicit scope.
