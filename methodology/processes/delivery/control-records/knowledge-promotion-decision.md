# Knowledge Promotion Decision

## Purpose

Use a knowledge promotion decision when learning from Delivery may become
durable product authority.

The decision records what learning was promoted, rejected, or archived, and
which semantic authority surface owns the promoted meaning.
It should also identify the target entry or new entry, intended entry state,
and source records.

## When To Use

Create a knowledge promotion decision when Delivery produces learning from:

```text
implementation results
product judgment
proof
runtime observation
founder decision
release handling
discipline usage that created a product-specific promotion candidate
reconciliation
```

Use the decision when the learning should influence future work beyond the
closed Delivery run.

Do not create this record for ordinary proof completion, landing status, or
closure status. Those are Control record or proof facts unless they reveal
durable product meaning.

## Minimum Contents

A knowledge promotion decision preserves:

```text
record id
record state
learning candidate
source work, product judgment, proof, observation, or founder decision
discipline source and usage when it shaped the candidate
decision
promotion basis or rejection basis
target semantic authority surface
target semantic authority entry or new entry
intended entry state
product record pointer, when promoted
rejection, archive, or deferral reason, when not promoted
retrieval condition, when deferred or archived
```

## Decision Outcomes

Use one explicit decision outcome:

```text
promoted: durable product meaning updated the owning semantic authority surface
rejected: the candidate is not product meaning or is not reliable enough
archived: the candidate is useful history but should not govern future work
deferred: the candidate may matter later, with retrieval condition and owner
not_applicable: no durable learning was present after review
```

Promotion writes only the interpreted product meaning into semantic authority.
The source records remain process, proof, observation, or archive material.
When the source is product judgment, promote only the durable product meaning
extracted from it. Leave one-run weighing, tradeoff, proof status, and closure
history in Control records.

Reject or archive:

```text
mechanical diff summaries
one-run proof status
agent commentary about how work went
runtime observations that have not been interpreted
process decisions that do not change product meaning
one-run product judgment that was satisfied but should not govern future work
possible follow-up work that should become a Signal
```

Promote when source material changes future product interpretation:

```text
Context when learning changes users, rationale, direction, constraints, or product posture
Intent when learning changes intended behavior, non-goals, role expectations, or acceptance meaning
Assurance when learning changes an invariant, obligation, risk constraint, or required check
Blueprint when learning changes structure, sequence, state, dependency direction, or interface boundary
Description when learning changes local implementation responsibility, sensitive edge, or safe modification guidance
```

## Lifecycle

Create a knowledge promotion decision when learning may become product
authority.

Update it when source records, decision, basis, target semantic authority
surface, target entry, intended entry state, product record pointer, rejection
reason, archive reason, deferral reason, or retrieval condition changes.

The decision is active while promotion, rejection, archive, or deferral is
unresolved. It exits active state when the decision is made and the product
record, archive decision, deferral, or rejection is recorded.

Validation check:

```text
decision and target surface are explicit when promoted
rejection, archive, deferral, or not_applicable reason is explicit when not promoted
product record pointer is present after promotion updates semantic authority
```

Forbidden ownership:

```text
current product authority without a semantic authority entry
proof status
release handoff state
```

## Template

```yaml
knowledge_promotion_decision:
  id: ""
  state: "closed"
  learning_candidate: ""
  source_records: []
  source_product_judgment: ""
  discipline_package: ""
  discipline_binding: ""
  discipline_slice: ""
  decision: ""
  decision_basis: ""
  target_semantic_authority_surface: ""
  target_semantic_authority_entry: ""
  intended_entry_state: ""
  product_record_pointer: ""
  rejection_archive_or_deferral_reason: ""
  retrieval_condition: ""
```

## Authority Boundary

The promotion decision is the bridge from process learning to product
authority. Product meaning governs future work only after the owning semantic
authority surface carries it.

Rejected or archive-only learning remains process history.

Closed product judgment remains process history unless this decision promotes
its durable product meaning.

When a candidate comes from discipline, promote only the product-specific
accepted statement. Do not copy the generic discipline rule into product semantic
authority.
