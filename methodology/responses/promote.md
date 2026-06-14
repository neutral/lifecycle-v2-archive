# Promote

## Use When

Use this response when Delivery, product judgment, proof, runtime observation,
or founder decision creates durable product meaning that should govern future
work.

## Required Output

Create or update a knowledge promotion decision, classify the learning, then
use `semantic-authority/update-product-meaning.md` only when the decision promotes
durable product meaning.

## Procedure

1. Name the learning candidate.
2. Name the source product judgment, proof, runtime observation, founder
   decision, or Control record.
3. Decide whether the learning is durable product meaning, useful history,
   behavior-changing follow-up, process-only learning, or not meaningful.
4. When promoted, name the owning semantic authority surface, target entry or
   new entry, intended entry state, and durable meaning.
5. Update the owning product entry through
   `semantic-authority/update-product-meaning.md`.
6. When rejected, archived, deferred, or routed to a new Signal, record the
   reason and retrieval condition in the owning process record.

## Promotion Boundary

Promote the product meaning, not the source artifact.

Examples:

```text
runtime observation shows users rely on completed todo history -> Intent may
need a durable completed-history behavior
test failure reveals an invariant -> Assurance may need a durable obligation
Build reveals a module boundary future edits must preserve -> Description or
Blueprint may need an update
product judgment identifies a durable exclusion that should govern future work ->
Intent or Assurance may need an update
release note summarizes what shipped -> no product authority by itself
agent summary says the change went well -> no product authority by itself
```
