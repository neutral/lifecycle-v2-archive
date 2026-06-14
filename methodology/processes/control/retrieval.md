# Control Record Retrieval

## Purpose

Use this page to decide which Control records enter active context.

Retrieval rules keep durable process state from becoming permanent working
context.

## Context Eligibility

A Control record is eligible for active context when it controls the current
question.

Read a Control record by default when:

```text
it is active
it is referenced by the active Clarity Boundary
it is referenced by the active Work Boundary
it carries active Context review state for current Clarity work
it carries the active product judgment for current Delivery work
it carries an open blocker, dependency, obligation, or decision
it proves current behavior, declared non-changes, or proof freshness
it is needed for current reconciliation, landing, release, closure, or audit
```

Keep a Control record out of default context when:

```text
the run is closed
the record is superseded
the record is archived
durable product meaning has been promoted elsewhere
the only reason to read it is a closed product judgment with no active pointer
the active Clarity Boundary does not reference it
the active Work Boundary does not reference it
the current proof or reconciliation question does not need it
```

Closed, superseded, and archived records can become eligible again by explicit
reference, proof freshness need, regression investigation, Discovery selection
history, dependency review, supersession review, or audit.

Prior process records are not shared mutable state. After a closed process has
been committed and current `records/control/` has been reset for the next
process, read prior process records through commit history only when the
current question explicitly needs audit, proof, supersession, or history.

## Retrieval Procedure

Use this order before acting:

```text
1. Identify the current control question.
2. Read the active Clarity Boundary and Context Review Packet, when Clarity is
   active.
3. Read the active Work Boundary and product judgment, when Delivery is active.
4. Read the active Discovery plan or selection handoff, when Discovery matters.
5. Read active records that carry open obligations.
6. Read referenced semantic authority, target, proof, observation, and Control records.
7. Read closed records only when a current reference or proof question requires them.
8. Read archived records only for audit, supersession, or historical investigation.
```

Do not retrieve Control records by recency alone. Recent records may be closed,
superseded, or unrelated. Old records may matter when the active work
references them.

## Retrieval Questions

Before loading more records, ask:

```text
What Context scope, source treatment, product judgment, decision, boundary,
obligation, proof, handoff, or closure state do I need?
Which active record should contain that state?
Is the record current, closed, superseded, or archived?
Does this record control the current work or only explain history?
```

If the answer is historical only, keep the record out of active context unless
the current work needs audit or supersession reasoning.
