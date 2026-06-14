# Invocation and Resume Protocol

## Purpose

Use this page at the start of every agent invocation in a target repo.

The protocol tells the agent how to find active Lifecycle state, choose
Clarity, Discovery, or Delivery, load only the context needed for the current
state, and leave the repo with explicit process state before stopping.

## Installed Methodology Boundary

Treat `.lifecycle/methodology/` as read-only during target codebase work. It is
installed methodology, not run-local scratch space.

When the installed methodology feels incomplete or wrong, record the friction
in `.lifecycle/scratch/` or in the owning Control record when the current run
depends on it. Do not edit `.lifecycle/methodology/` during the run unless the
user explicitly asks to update installed methodology.

## Start Procedure

Start every invocation from the current target repo state.

Use this order:

```text
1. Locate the installed Lifecycle methodology.
2. Check active Control records before reading closed history.
3. Check open stop-work requests for active runs when local support exists.
4. Determine the active Lifecycle state.
5. Route to Clarity, Discovery, Delivery, or closure.
6. Load only the records needed for the active state.
7. Continue the process state machine.
8. Stop only after closing or leaving explicit active state.
```

The agent should not restart work from the prompt alone when active Control
records exist.

## Active State Scan

Before deciding what to do, look for records with active process state.

Check for these states:

```text
active
blocked
deferred
landing-ready
landed
```

Match actual `state` fields. Do not treat outcome fields such as
`landing_state` or `landing_or_abandonment_state` as active process state.

Treat `closed`, `superseded`, and `archived` records as off by default unless
an active record points to them or the current question requires proof,
supersession, audit, or history.

## Starting A New Process

A new independent Clarity, Discovery, or Delivery process should start from
fresh process-local Control records.

Before creating the first Control record for the new process, confirm whether
the prior process's Control records were already committed for history. If they
were committed, reset current `records/control/` to neutral scaffolding before
starting the new process. Keep semantic authority records and target artifacts
intact; they are the cross-process product state.

If prior Control records are uncommitted, do not delete them. Close, commit,
ask, or explicitly carry forward their state before starting another process.

The agent may read prior Control records only by explicit pointer, proof need,
audit, supersession reasoning, or history. Prior process records are not shared
mutable state for the next process; they are history, not shared mutable state.

## Routing

If an active Delivery Work Boundary exists, resume Delivery.

If active Clarity state exists and no Delivery Work Boundary overrides it,
resume Clarity.

If active Discovery plan state exists and no concrete Signal overrides it,
resume Discovery.

If no active process state exists and the prompt asks a broad product,
rationale, strategy, Context, corpus, canonicalization, freshness, or meaning
question, start Clarity.

If no active process state exists and the prompt provides a concrete Signal,
start Delivery.

If no active process state exists and the prompt asks what to do next, how to
continue, or how to sequence possible work, start Discovery.

If the active state is `landing-ready`, resume at the Delivery landing or
release handoff.

If the active state is `landed`, resume at runtime, learning, closure, or
archive handling.

If multiple active records conflict, stop and reconcile the active state before
building.

If an open stop-work request exists for the active run, use
[../local-support/stop-work-request.md](../local-support/stop-work-request.md)
before expanding target work.

## Live Control Cadence

Control records are live process state.

Before making substantive repository edits, the agent must have:

```text
active Clarity Boundary for Context edits in a Clarity run
active Work Boundary for the run, including product judgment before Delivery Build
active Evidence Packet for the run when proof obligations exist or proof will be needed
```

Substantive edits include product authority, target code, tests, setup, tools,
Lifecycle source or methodology, notes-map strategy, package/config files, and
generated installed output that will be relied on. Neutral setup scaffolding,
initial inspection, Clarity Boundary creation, Work Boundary creation, Context
Review Packet creation, and initial Evidence Packet creation are not
substantive Build work.

If the agent discovers that substantive edits already happened without that
live cadence, the run has failed Lifecycle process requirements. Stop normal
work, notify the founder-dev immediately, record the failure in the active or
blocked Control state if possible, and do not continue by writing retrospective
Landing or Closure records that imply the cadence was followed.

Discovery has the same live-state requirement for selection work. When the
prompt asks what to do next, how to continue, or how to sequence possible work,
create or update Plan Items and the Plan Map as candidate state changes. If
Delivery needs Discovery context, create the Selection Handoff before Delivery
relies on it. Missing Discovery state discovered after Delivery started is a
Lifecycle cadence failure, not closure cleanup.

Clarity has the same live-state requirement for Context work. When the prompt
asks the agent to improve, clarify, organize, canonicalize, review, or deepen
Context, create or update the Clarity Boundary and Context Review Packet before
Context state changes depend on them. Missing Clarity state discovered after
Context edits is a Lifecycle cadence failure, not closure cleanup.

## Active Context Load Order

Load context in this order:

```text
1. Active Control record.
2. Records with open blockers, dependencies, obligations, or decisions.
3. Records directly referenced by the active Control record.
4. Open stop-work requests for the active run when local support exists.
5. Semantic authority slice needed for current product meaning.
6. Target, proof, and observation only when the active state needs them.
7. Closed records only by explicit pointer or proof need.
8. Archived records only for audit, supersession, or history.
```

Do not load records by recency alone. Recent records may be closed or
unrelated. Older records may matter when active work points to them.

## Clarity Resume

When resuming Clarity:

```text
1. Read the active Clarity Boundary.
2. Read the Source Inventory when source treatment affects the current step.
3. Read the Context Review Packet when route, content, canonicalization,
   promotion, or retrieval checks affect the current step.
4. Read the smallest current Context slice needed for the active scope.
5. Update Context only inside the active Clarity Boundary.
6. Record promotion pressure and recommendations without starting another
   process.
7. Close with a Clarity Closure Record when the Context pass is done, blocked,
   deferred, superseded, or archived.
```

Clarity resumes from [clarity/process.md](clarity/process.md).

## Discovery Resume

When resuming Discovery:

```text
1. Read the plan map when it exists.
2. Read active, blocked, deferred, or selected plan items relevant to the prompt.
3. Read a selection handoff only when Delivery admission needs it.
4. Create or update plan items and the plan map before candidate state survives.
5. Refresh plan item state before selecting new work.
6. Create a selection handoff before Delivery consumes Discovery context.
7. Route selected work into Delivery only through a selected Signal.
```

Discovery resumes from [discovery/process.md](discovery/process.md).

## Delivery Resume

When resuming Delivery:

```text
1. Read the active Work Boundary.
2. Confirm product judgment is present when the current state is Work Boundary
   active or later.
3. Identify the current Delivery state.
4. Read the Delivery process definition.
5. Read the phase or gate that owns the current state.
6. Read the Evidence Packet, Landing Packet, release summary, promotion
   decision, archive decision, or closure record only when the current state
   needs it.
7. Read open stop-work requests for the active run when local support exists.
8. Read semantic authority through the semantic authority surface contract only
   when product meaning governs the current step.
```

Delivery resumes from [delivery/process.md](delivery/process.md).

## Stop Rule

Before ending an invocation, leave explicit process state.

The agent should do one of these:

```text
close the process
leave the active record active with the next action
mark the record blocked with the blocker and unblock condition
mark the record deferred with the deferral reason
mark the record landing-ready with the remaining handoff
mark the record landed with remaining runtime, learning, archive, or closure work
record a stop-work request outcome when it changed durable process state
```

Do not leave hidden state in the chat transcript only. Persist state in the
owning Control record when future work depends on it.

## Failure Response

When the invocation cannot determine state:

```text
1. Stop before Build or release action.
2. Identify the records that conflict or are missing.
3. Ask the smallest product-shaped, judgment-shaped, or process-shaped question
   needed to proceed.
4. Record the blocked state when the blocker should survive.
```

The agent should not compensate for unclear state by writing broad summaries.
It should repair the owning record or ask for the missing decision.
