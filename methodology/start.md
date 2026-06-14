# Start

## Purpose

Use this page at the start of target-codebase work.

Start does not decide product meaning or process state. It finds the active
Lifecycle state and routes the agent to the installed methodology page that owns
the next action.

## Authority Reminders

Carry these distinctions through every state:

```text
A prompt is not a requirement.
A plan is not permission.
A test is not acceptance.
Code is not intent.
```

Each line names a silent promotion. When current work rests on one, stop and
give the claim its owning form: product judgment in an admitted Work Boundary,
evidence covering a proof obligation, or an admitted semantic authority update.

## Procedure

1. Read `registry.md`.
2. Read `.lifecycle/disciplines/catalog.md` when the Signal or active work
   may touch installed discipline.
3. Scan `records/control/` for active, blocked, deferred, landing-ready, or
   landed Control records.
4. Check `.lifecycle/stop-work-requests/` for open requests that name an active
   run before expanding target work.
5. If an open stop-work request exists, use
   `local-support/stop-work-request.md` before target work continues.
6. If no active Control record exists, use `states/no-active-work.md`.
7. If Clarity has active records, use `states/clarity-active.md`.
8. If Discovery has active records, use `states/discovery-active.md`.
9. If Delivery has active records, use the state page named by the active
   Delivery record.
10. Before starting a new independent Clarity, Discovery, or Delivery process, confirm
   `records/control/` does not carry closed records from a prior committed
   process as current HEAD state.
11. If state is ambiguous, stop and update the owning Control record before doing
   target work.
12. Before Context edits in Clarity, confirm the run has an active Clarity
    Boundary and Context Review Packet when review checks will be needed.
13. Before substantive Delivery edits, confirm the run has an active Work
    Boundary with product judgment and, when proof obligations exist or proof
    will be needed, an active Evidence Packet.
14. Before Delivery consumes Discovery-selected work, confirm the selected
    Plan Item, Plan Map, and Selection Handoff were updated live.

If the previous process was committed for history, start the next independent
process from fresh `records/control/` scaffolding. Preserve semantic authority
records; they carry durable product continuity across processes.

If substantive edits already occurred without the active Work Boundary and
Evidence cadence, stop and notify the founder-dev immediately. Treat that as a
Lifecycle process failure, not as missing paperwork to reconstruct at the end.

If Context edits already occurred without the active Clarity Boundary and
Context Review Packet cadence, stop and notify the founder-dev immediately.
Treat that as a Lifecycle process failure, not as missing paperwork to
reconstruct at the end.

If Discovery selection state was only noticed after Delivery already depended
on it, stop and notify the founder-dev immediately. Treat missing Plan Item,
Plan Map, or Selection Handoff cadence as a Lifecycle process failure, not as
closure cleanup.

## Required Outputs

The invocation must end with one of these outcomes:

```text
explicit active state
closed work
blocked work with blocker and next retrieval pointer
deferred work with retrieval condition
landed work routed to runtime, learning, or closure handling
stop-work request accepted, resolved, routed, split, discarded, or explicitly ignored
```

Do not leave future work only in chat.
