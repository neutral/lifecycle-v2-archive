# Control Record Closure

## Purpose

Use this page to turn active process state into durable history with clear
pointers.

Closure prevents closed, superseded, archived, or unrelated records from
remaining in active context after they stop controlling current work.

## Closure Role

Discovery closure is recorded in the plan map and owning plan items.

A Delivery closure record should answer:

```text
what ended
what landed or was abandoned
what product judgment was satisfied, superseded, abandoned, or promoted
what remains active
what was deferred, blocked, superseded, or archived
what learning was promoted
what semantic authority storage now carries durable product meaning
what proof or handoff records matter later
what can stay off by default
```

Closure should leave future agents with a small pointer map.

## Compaction Rule

Use this routing during closure:

```text
durable product meaning -> semantic authority -> semantic authority storage
durable learning from product judgment -> knowledge promotion decision -> semantic authority
reusable learning -> knowledge promotion decision
proof status -> Evidence Packet
handoff state -> Landing Packet
release exposure -> release summary
closed product judgment and other process detail -> closure record and history
superseded process state -> superseded pointer
archive-only material -> archive decision
```

Do not copy whole records into closure. Point to them.

## Off By Default

After closure, remove closed, superseded, archived, or unrelated records from
active context.

Keep them retrievable through:

```text
archive pointers
supersession pointers
closure records
explicit references from active work
```

Closed does not mean deleted. It means the record should not enter active
context unless a current pointer or audit need reactivates it.

## Process Reset

After the closed process has been committed for history, the next independent
Lifecycle process should begin with a fresh current `records/control/` area.

Resetting current Control records does not delete history when the closed
records were already committed. It removes prior process state from current
HEAD so the next process owns only its own Control records.

Do not reset semantic authority records when starting a new process. Product
meaning that should carry forward must already live in Context, Intent,
Assurance, Blueprint, Description, target artifacts, proof, observation, or an
explicit follow-up reference.

Do not carry closed product judgment forward as current authority. If it should
shape future work, promote the durable product meaning into semantic authority
before closure completes.
