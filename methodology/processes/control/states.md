# Control Record States

## Purpose

Use this page to decide what a Control record state means.

State is a retrieval signal. It tells the agent whether a record should enter
active context by default, only by reference, or only for audit.

## States

Use these states for Control records:

```text
active
blocked
deferred
landing-ready
landed
closed
superseded
archived
```

`active` means the record controls current work.

`blocked` means the record cannot move forward until a blocker is resolved.

`deferred` means the record remains valid process state but is not current
work.

`landing-ready` means proof, product judgment coverage, and reconciliation are
satisfied and the record is ready for release or merge handoff.

`landed` means the work landed but may still need release handling,
observation, knowledge promotion, archive decisions, or closure.

`closed` means the process or run ended. Closed records remain durable but do
not enter active context unless referenced or needed for proof, audit, or
history. After the closed process is committed, the next independent process
may reset current `records/control/` and leave the closed records retrievable
through commit history instead of current HEAD.
Closed product judgment is historical process state unless durable meaning was
promoted into semantic authority.

`superseded` means a newer record replaced the record's active process state.

`archived` means the record remains historical material only.

## State Update Rule

When a Control record changes state, update the owning record and any record
that references the old state in the same work pass.

Stale state makes retrieval expensive because the agent must read records to
decide whether they matter.
