# Delivery Process

## Purpose

Use this page to run one Delivery from Signal to closure.

Delivery turns one concrete Signal into bounded production change through
explicit product judgment, active admission, and current proof. It is the
agent-facing process for target repos.

Use [gates.md](gates.md) when deciding whether the current state can advance.
Use phase pages when a state needs deeper operating rules. Use
[../../disciplines/use-discipline.md](../../disciplines/use-discipline.md)
when reusable practice judgment may constrain the work. Use
[../../semantic-authority/surfaces/update-procedure.md](../../semantic-authority/surfaces/update-procedure.md)
when Delivery discovers product meaning that may need semantic authority.

Product judgment is not a separate process state. It is the weighing step inside
Framing that explains which behavior the agent is about to accept, why that
behavior is right now, what tradeoff is being chosen, what is explicitly
excluded, and what evidence would falsify the judgment. The active Work
Boundary records that judgment before Build may change production behavior.

## Start Conditions

Start Delivery when there is a concrete Signal:

```text
founder prompt
Discovery-selected Signal
bug report
runtime observation
support request
```

Use [Discovery](../discovery/process.md) when the next useful work is unclear.

Use [Clarity](../clarity/process.md) when the concrete blocker is missing,
stale, contradictory, or unreviewed Context and the work is to build the
Context layer rather than admit behavior.

## Process State Machine

Delivery moves through these process states:

```text
Signal received
-> Work Boundary active
-> Build active
-> final work delta frozen
-> Evidence produced
-> reconciled
-> landing ready
-> landed or abandoned
-> runtime and learning resolved
-> closed
```

Each state has one controlling question and one exit condition.

### Signal Received

The controlling question is what selected meaning is being considered. This
state exits when the meaning is clear enough to admit or reject.

### Work Boundary Active

The controlling question is what product judgment supports admitting this work,
and what work is bounded and obligated by that judgment. This state exits when
the active Work Boundary has product judgment, recommendation basis, tier, scope,
execution boundary, proof obligations, and semantic authority update
obligations.
It also exits only after material discipline has been selected, rejected,
or marked not applicable.

### Build Active

The controlling question is whether the agent is changing only work admitted by
the product judgment and Work Boundary. This state exits when the intended work
delta is complete inside the active Work Boundary and execution boundary.

### Final Work Delta Frozen

The controlling question is what exact delta is being proven. This state exits
when the agent stops changing the work delta except to fix proof or
reconciliation failures.

### Evidence Produced

The controlling question is what proof satisfies the proof obligations and
product judgment consequences. This state exits when the Evidence Packet covers
the final work delta and admitted product judgment with current proof.

### Reconciled

The controlling question is whether actual work matched the admitted product
judgment and admitted work. This state exits when actual changes, declared
non-changes, touched surfaces, execution actions, proof coverage, and semantic
authority updates match the active Work Boundary or are resolved.

### Landing Ready

The controlling question is whether the work can be handed off for merge or
release. This state exits when the Landing Packet records the handoff.

### Landed Or Abandoned

The controlling question is whether the run landed or was explicitly stopped.
This state exits when release exposure, observation, and learning are handled
or marked not applicable.

### Runtime And Learning Resolved

The controlling question is whether runtime output or learning should affect
future work. This state exits when promotion, archive, rejection, deferral, or
no-learning decisions are complete.

### Closed

The controlling question is whether any active process state remains. This
state exits when the closure record exists and the active Work Boundary is
closed.

Delivery may abandon work from any active state. Abandonment still requires
closure for any Control record that entered active state.

## Normal Path

Use this order:

```text
1. Interpret the Signal.
2. Retrieve only semantic authority needed to avoid a bad interpretation.
3. Retrieve discipline when reusable practice judgment materially constrains the work.
4. State the product judgment that weighs authority, repo facts, risk, tradeoffs, exclusions, and falsifiers.
5. If missing Context is the work, stop and route to Clarity instead of
   smuggling broad Context repair into Delivery.
6. Create or confirm the active Work Boundary with that product judgment.
7. Build only inside the active Work Boundary and execution boundary.
8. Freeze the final work delta for proof.
9. Produce the Evidence Packet, referencing standing Required Checks when
   governing entries bind them.
10. Reconcile actual work against the admitted product judgment and active Work Boundary.
11. Produce the Landing Packet when landing ready.
12. Handle release exposure, runtime classification, and learning.
13. Produce promotion, archive, rejection, deferral, or no-learning decisions.
14. Produce the closure record and close the active Work Boundary.
```

## State Transitions

### Signal Received To Work Boundary Active

Continue when selected meaning is clear enough to frame into product judgment.
Return or stop when meaning, authority, risk, ownership, or the behavior being
accepted is ambiguous.

### Work Boundary Active To Build Active

Continue when the active Work Boundary records a sufficient product judgment
and is complete, admitted, and supported by repo evidence. Return or stop when
the product judgment or Work Boundary is incomplete, stale, unadmitted,
unsupported by repo state, falsified by discovered facts, or unsupported by the
semantic authority or discipline the work depends on.

### Build Active To Final Work Delta Frozen

Continue when work appears complete inside scope and the product judgment still
holds. Return or stop when judgment, scope, surface, authority, execution
boundary, or proof obligations changed.

### Final Work Delta Frozen To Evidence Produced

Continue when proof commands and proof obligations are known. Return or stop
when the proof path is unclear, missing, stale, or outside the execution
boundary.

### Evidence Produced To Reconciled

Continue when proof is current against the final work delta and product
judgment proof consequences. Return or stop when a proof gap, stale proof,
failed proof, product judgment mismatch, or admitted/actual mismatch exists.

### Reconciled To Landing Ready

Continue when actual work matches admitted product judgment and admitted work,
and required obligations are resolved or explicitly carried forward. Return or
stop when mismatch, unadmitted behavior, violated exclusion, or unresolved
update obligation exists.

### Landing Ready To Landed Or Abandoned

Continue when the Landing Packet records merge, release, or abandonment
handoff. Return or stop when the handoff, release, or abandonment decision is
unclear.

### Landed Or Abandoned To Runtime And Learning Resolved

Continue when release exposure and observations are classified. Return or stop
when runtime response, incident handling, rollback, or learning remains open.

### Runtime And Learning Resolved To Closed

Continue when the closure record exists and active Control records are closed
or explicitly carried forward. Return or stop when any active obligation or
Control record remains unresolved.

## Core Rules

Every Delivery should follow these rules:

```text
1. Treat the prompt or Discovery-selected Signal as a Signal, not automatically
   as authority.
2. Retrieve the smallest sufficient semantic authority slice.
3. Retrieve the smallest useful discipline slice when reusable practice
   judgment materially constrains the work.
4. Stop before Build when earlier semantic authority is too sparse for the
   current work.
5. State the product judgment that admits the behavior: behavior accepted, why
   now, tradeoff, explicit exclusions, falsifiers, and proof consequences.
6. Establish or confirm an active Work Boundary with that product judgment,
   admitted scope, and a recommendation basis before changing production
   behavior.
7. Build only inside the active Work Boundary and its execution boundary.
8. Respond to open stop-work requests before expanding target work.
9. Raise the decision when work needs new behavior, new surfaces, restricted
   surfaces, broader execution, changed assumptions, or a higher tier.
10. Record selected discipline usage when it shaped the run.
11. Record a judgment delta when the product judgment changes: old judgment,
    new evidence, changed premise or tradeoff, new judgment, and unchanged
    tradeoffs.
12. Freeze the final work delta before proof.
13. Prove the final work delta against the proof obligations and product
    judgment proof consequences.
14. Reconcile actual work against admitted product judgment and admitted work
    before landing readiness.
15. Keep runtime observations and agent summaries out of product authority
    unless knowledge promotion writes interpreted meaning into semantic
    authority.
16. Do not treat a closed Work Boundary or its product judgment as durable
    product authority.
17. Only admitted behavior can ship.
18. Let repo state control recommendations. Conversation frames are Signals,
    not controlling evidence.
19. Record a recommendation delta when the recommendation changes: old
    recommendation, new evidence, changed premise or tradeoff, new
    recommendation, and unchanged tradeoffs.
```

## Milestone Terms

Use these terms consistently:

```text
Landing ready: proof, product judgment coverage, and reconciliation are
current, and handoff can proceed.
Landing: merge, release, or abandonment handoff for the reconciled work delta.
Release: landed behavior is exposed to runtime.
Delivery closure: active Delivery state is closed after landing or abandonment,
runtime handling, learning, archive, and obligations are resolved.
Delivery complete: Delivery closure has happened and no hidden active process
state remains.
```

Use `ship` only for production behavior. Do not use it as a synonym for
landing, release, or Delivery complete.

## Control Records

Create the smallest records that preserve control.

```text
Work Boundary: required before Build changes production behavior; records the
admitted product judgment, scope, execution boundary, and obligations.
Evidence Packet: required before landing readiness; records proof coverage for
the final work delta and admitted product judgment.
Landing Packet: required for merge, release, or abandonment handoff; points to
product judgment coverage.
Release summary: required when release exposure or runtime handling matters.
Knowledge promotion decision: required when learning may become product authority.
Archive decision: required when useful material remains history only.
Closure record: required before Delivery complete; records product judgment
outcome as closed process state unless durable learning was promoted.
Discipline usage: required in the active Control record when selected
discipline shaped the run.
```

Use [control-records/overview.md](control-records/overview.md) for Delivery
Control record pages.

## Decision Rules

Use these defaults:

```text
continue when the active Work Boundary controls the work
ask when product meaning, policy, risk, or proof is ambiguous
stop and reframe when product judgment, scope, tier, execution, or proof no longer fits
split when discovered work is required but outside the active Work Boundary
defer when discovered work should survive but not block this landing
abandon when the selected meaning is wrong or unsafe
prove when the final work delta is ready to freeze
land when proof, product judgment coverage, and reconciliation are current
promote when learning should govern future product judgment
archive when material is useful history only
close when landing or abandonment, runtime, learning, and obligations are resolved
```

## Failure Routing

When a state fails, route to the owning state:

```text
Signal unclear -> ask, defer, or return to Discovery.
authority stale or sparse -> resolve semantic authority before Build.
discipline material, conflict, or proof effect unresolved -> return to Framing.
product judgment missing, unsupported, or falsified -> return to Framing.
Work Boundary incomplete -> finish Framing.
recommendation unsupported -> inspect repo state and update the Work Boundary
recommendation changed -> record recommendation delta in the Work Boundary
product judgment changed -> record judgment delta in the Work Boundary
scope expanded -> remove, split, defer, abandon, or start a fresh Work Boundary.
execution boundary exceeded -> stop and reframe.
proof path unclear -> define proof obligations before proof.
proof stale or missing -> refresh proof or record proof gap.
open stop-work request -> accept, resolve, ask, split, discard, or explicitly ignore before target expansion.
actual/admitted mismatch -> fix, admit, split, defer, or abandon.
runtime issue -> classify as Signal, incident input, evidence, learning, or archive.
closure blocked -> keep Delivery active with explicit blocker state.
```

## Runtime And Learning

Runtime observations can become supporting evidence, incident inputs, learning
candidates, or new Signals. Behavior-changing runtime follow-up starts as a
Signal. Discovery can select that Signal when the next action is unclear.

Runtime observations and agent summaries do not become durable product
authority unless knowledge promotion writes interpreted meaning into semantic
authority.

## Completion Conditions

Delivery is complete only when:

```text
landing or explicit abandonment is resolved
release exposure is handled or not applicable
runtime observations are classified or not applicable
learning is promoted, archived, rejected, deferred, or not applicable
semantic authority update obligations are resolved or explicitly carried forward
product judgment outcome is recorded as satisfied, superseded, abandoned, or
promoted into durable authority when it contains durable learning
discipline usage is recorded or explicitly not applicable
required Control records exist
active Work Boundary is closed
closure record exists
```
