# Human Guide: Inspect

## Purpose

Use this guide when a human wants quick Lifecycle understanding from `lt`
without running full verification.

`inspect` shows the tool's parsed view of product authority, active process
state, records, runs, findings, receipts, and indexes. It does not decide the
next Lifecycle movement.

## Quick Orientation

Start with status:

```text
lt status --target .
```

Then inspect the active process state:

```text
lt inspect active --target .
```

Use this when you want to know whether Delivery or Discovery records are active
before reviewing code, proof, or handoff state.

## Product Understanding

Use product inspection to see the installed semantic authority surfaces and
entries:

```text
lt inspect product --target .
lt inspect authority --target .
lt inspect authority --target . --surface intent
lt inspect authority --target . --surface context
```

This helps a human see what product meaning Lifecycle can currently retrieve.
It is not a substitute for reading the owning semantic authority entry when a
decision depends on product meaning.

For Context, the authority inspection includes a `contextAtlas` summary with
area, cluster, role, relation, review, freshness, duplicate-id, folder
overview, and root-flat-file observations. Use it to orient before reading the
owning Context entries or Clarity records. The default entry payload is compact;
add `--detail full` only when raw entry text or parsed YAML is needed.

## Process Understanding

Inspect one record when a finding, run summary, or handoff references it:

```text
lt inspect record <record-id> --target .
```

Inspect a run when you want the Control records, proof obligations, and receipts
for one Delivery or Discovery run:

```text
lt inspect run <run-id> --target .
```

## Finding And Receipt Review

Use finding inspection before deciding what Lifecycle movement owns the
response:

```text
lt inspect finding <finding-id> --target .
lt explain finding <finding-id> --target .
```

Use receipt inspection to see proof command output, covered obligations, and
freshness inputs:

```text
lt inspect receipt <receipt-id> --target .
lt explain receipt <receipt-id> --target .
```

## Index Review

Use index inspection when you need to know what the tool collected:

```text
lt inspect index --target .
```

The index is derived. If it looks stale, refresh or rebuild support before
trusting a broader check:

```text
lt support status --target .
lt support index --target .
```

## JSON Output

Humans can use text output for quick scans. Use JSON when comparing repeated
runs or feeding results to another script:

```text
lt inspect active --target . --json
lt inspect run <run-id> --target . --json
```

## Boundary

`inspect` reports observed structure. It does not admit work, prove work,
promote product meaning, land work, or close work.

After inspection, the human or agent still chooses the owning Lifecycle action
and records durable process state in the appropriate Control record.
