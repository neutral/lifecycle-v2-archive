# Stop-Work Request

## Purpose

Use a stop-work request when an external source asks the acting agent to stop
expanding target work during an active run.

A stop-work request is an interruption interface. It is not product authority,
product judgment, proof, or process state by itself.

## Location

Store local stop-work requests under:

```text
.lifecycle/stop-work-requests/<run-id>/<source-id>.<timestamp>.md
```

The source id identifies the human, wrapper, script, observer, CI job, or local
policy that issued the request.

The folder root holds at most a neutral `overview.md` that explains the folder.
That file is not a request. Every request lives under a run-id subdirectory;
treat any other root-level file as a misplaced request and route it to its run.

## Required Contents

Use this shape:

```yaml
stop_work_request:
  id: ""
  source_id: ""
  run_id: ""
  active_state: ""
  requested_stop: "forward-target-work"
  trigger_condition: ""
  evidence:
    files: []
    records: []
    work_trace_events: []
    commands: []
    diffs: []
  requested_route: ""
  blocked_forward_actions: []
  allowed_resolution_actions: []
  resolution_condition: ""
  ignored_by_policy: false
  ignored_reason: ""
  issued_at: ""
```

## Checkpoints

When `.lifecycle/stop-work-requests/` exists, check for open requests for the
active run before:

```text
starting or resuming target work
expanding the target delta after a pause
running proof as final
declaring landing readiness
closing the active run
```

## Response Rule

When an open stop-work request exists, stop expanding target work long enough to
classify the request.

Choose one outcome:

```text
accept and route to the owning Lifecycle state
resolve because current repository state disproves the trigger
ask the founder-dev for the owning decision
discard or split the current work
ignore under explicit local policy with a reason
```

Do not silently ignore a stop-work request.

## Recording Rule

Keep the raw request local unless it changes durable state.

Record the interpreted outcome in the owning Control record when the request:

```text
changes the active state
creates a blocker
changes or falsifies product judgment
changes proof status
changes authority treatment
changes landing readiness
causes a split, discard, or closure decision
```

Do not copy the raw request into semantic authority storage.
