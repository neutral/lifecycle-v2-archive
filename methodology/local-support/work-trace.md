# Work Trace

## Purpose

Use a work trace when an active run needs a local sequence of meaningful agent
actions.

The acting agent, wrapper, or local tooling may write the work trace. External
observers may read it, but the trace is never the only source of truth.

## Location

Store work trace events under:

```text
.lifecycle/work-traces/<run-id>/work-log.jsonl
```

The run id should match the active Control record, local run label, or wrapper
run id used by the acting system.

## When To Use

Use a work trace when one of these applies:

```text
the founder-dev asks for local action tracing
a wrapper or outside observer needs sequence, command, or externality evidence
the Work Boundary is broad, high-risk, or touches several target surfaces
the run uses side-effecting tools, credentials, external systems, migrations, deployments, or destructive commands
the run changes several Control records or authority-related files
the agent needs better resume evidence than chat history alone
```

Small local changes may not need a work trace.

## Event Shape

Write one JSON object per line.

Use this shape:

```json
{
  "event_id": "evt-0001",
  "timestamp": "2026-05-27T15:04:05Z",
  "actor": "acting-agent",
  "state": "build-active",
  "action_type": "file-edit",
  "summary": "Updated invite service duplicate handling.",
  "paths": ["src/invites/service.ts"],
  "command": "",
  "externality": "none",
  "work_boundary_ref": "records/control/delivery/work-boundaries/wb.team-invite-create.md",
  "evidence_ref": "",
  "result": "changed",
  "notes": ""
}
```

## Event Types

Use these action types:

```text
read
file-edit
record-edit
command
test
generated-output
semantic-authority-update
disciplines-use
proof-update
decision
route-change
cleanup
```

Use `externality` to mark side-effect risk:

```text
none
local-only
network-read
network-write
credential-use
runtime-read
runtime-write
deployment
migration
destructive
```

## Reading Rule

The work trace is weaker than repository state.

Pair trace events with current facts:

```text
trace says a file was edited -> inspect current diff
trace says a command ran -> inspect proof output or terminal result
trace says a record changed -> inspect the current record
trace says an external action happened -> compare it to the execution boundary
```

Do not rely on the trace when the worktree, records, or proof contradict it.

## Promotion Rule

Do not commit raw work trace events as product records or Control records.

Only move trace content into committed records when the interpreted fact changes
process state, product judgment, proof status, authority treatment, closure, or
learning. Rewrite the fact in the owning record's language. A trace can show
that the agent made a decision; it cannot substitute for product judgment in
the active Work Boundary.
