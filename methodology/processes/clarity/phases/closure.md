# Clarity Closure

## Purpose

Use Clarity Closure to close the Context pass without starting another process.

Closure should preserve what changed, what still needs review, and what the
founder-dev may choose next.

## Required Closure Contents

Record:

```text
Context entries created, updated, moved, superseded, or deferred
review depth completed
unresolved Context gaps
promotion pressure
recommendations
founder-dev decisions needed
records remaining active
no-auto-start confirmation
next retrieval pointer
```

## Exit

Exit when the Clarity Closure Record is closed or explicitly blocked/deferred,
and no recommendation claims to have started Discovery or Delivery.
