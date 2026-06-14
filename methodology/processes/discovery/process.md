# Discovery Process

## Purpose

Use this page when the next useful work is unclear.

Discovery preserves possible-work state and selects Signals for Delivery. It
does not admit behavior, state product judgment, or authorize Build.

Use [gates.md](gates.md) when deciding whether the current state can advance.
Use [control-records/overview.md](control-records/overview.md) for Discovery
Control record pages.

## Start Conditions

Start Discovery when the prompt asks the agent to find, continue, sequence, or
clarify useful work and no concrete Signal is already selected.

Use [Clarity](../clarity/process.md) when the prompt is primarily about
building, reviewing, organizing, or canonicalizing Context rather than choosing
the next useful Signal.

Use [Delivery](../delivery/process.md) when the founder-dev already provides a
concrete Signal.

## Live Control Cadence

Discovery Control records are live process state. They are not retrospective
notes and cannot be recreated only after selection, Delivery framing, or
closure.

When a prompt asks the agent to pick, continue, sequence, or find useful work,
Discovery must create or update the relevant Plan Item and Plan Map as soon as
candidate state should survive the current thought. If Delivery will consume
Discovery context, the Selection Handoff must exist before Delivery relies on
that context in a Work Boundary.

If Discovery selection work was done without live Plan Item, Plan Map, or
Selection Handoff state, stop the run, notify the founder-dev that Lifecycle
cadence failed, and repair or restart the process instead of reconstructing
Discovery records at the end.

## Inputs

Discovery reads across Lifecycle roles:

```text
semantic authority
discipline catalog when candidate work may touch installed discipline
target
proof
observation
Control records
founder-dev input
temporary working notes when relevant
```

Direction belongs in Context as future-facing product meaning. Plans are
Discovery Control records. When Direction itself is missing, stale,
contradictory, or hard to retrieve, recommend or start Clarity according to the
prompt instead of burying the gap in plan state.

Discovery can use Direction, current semantic authority, candidate discipline,
target facts, proof, runtime observations, prior Control records, and
recent founder-dev input to derive candidate Signals.

Use [../../semantic-authority/surfaces/contract.md](../../semantic-authority/surfaces/contract.md)
to retrieve semantic authority by entry state, stable identity, scope, and
related semantic authority.

## Process State Machine

Discovery moves through these process states:

```text
no active Discovery
-> Discovery active
-> candidate set prepared
-> founder selection needed
-> selected, deferred, rejected, blocked, closed, or more Discovery requested
-> selection handoff produced when needed
-> plan state refreshed
-> closed or left active
```

Each state has one controlling question and one exit condition.

### No Active Discovery

The controlling question is whether the next useful work is unclear. Discovery
starts only when a concrete Signal is not already selected.

### Discovery Active

The controlling question is what current product and process context matters.
This state exits when the agent has enough semantic authority, candidate
discipline, plan, target, proof, observation, or Control record context to
prepare candidates.

### Candidate Set Prepared

The controlling question is what candidate Signals are worth founder
attention. This state exits when candidate Signals include source basis,
usefulness, known unknowns, and selection question.

### Founder Selection Needed

The controlling question is what should happen to each candidate. This state
exits when the founder-dev selects, defers, rejects, blocks, asks for more
Discovery, or leaves Discovery active.

### Selected, Deferred, Rejected, Blocked, Closed, Or More Discovery Requested

The controlling question is what durable plan state changed. This state exits
when plan items and the plan map reflect the decision.

### Selection Handoff Produced When Needed

The controlling question is whether Delivery needs Discovery context. This
state exits when selection rationale, source basis, blockers, dependencies,
candidate discipline, and semantic authority context are captured when needed.

### Plan State Refreshed

The controlling question is whether future Discovery can resume cheaply. This
state exits when active, blocked, deferred, selected, rejected, closed, and
superseded items are current.

### Closed Or Left Active

The controlling question is whether any useful Discovery state remains open.
Discovery closes when no open Discovery attention remains, or stays active with
explicit open state.

Discovery may stop without selecting work. Stopping still requires plan state
to reflect blockers, deferrals, rejections, closures, or absence of useful
candidates.

## Normal Path

Use this order:

```text
1. Read current Direction and relevant semantic authority when product meaning matters.
2. Read `.lifecycle/disciplines/catalog.md` when candidate work may touch installed discipline.
3. Read the plan map when one exists.
4. Read active, blocked, or deferred plan items relevant to the current question.
5. Create or update live plan items and the plan map when candidate state should survive.
6. Inspect target, proof, observation, and Control records only when selection needs them.
7. Identify candidate Signals, blockers, dependencies, deferrals, and closures.
8. Update plan items and the plan map as candidate state changes.
9. Ask the founder-dev to select, defer, reject, block, close, or request more Discovery.
10. Record the selected, deferred, rejected, blocked, closed, or active outcome before Delivery consumes it.
11. Produce a selection handoff when selected work needs context in Delivery.
12. Close or refresh Discovery state.
```

Discovery can start from prompts such as:

```text
continue
move this forward
what should we do next?
look at the repo and decide what is next
```

## State Transitions

### No Active Discovery To Discovery Active

Continue when the next useful work is unclear. Return or stop when a concrete
Signal already exists.

### Discovery Active To Candidate Set Prepared

Continue when enough current context exists. Return or stop when Direction,
authority, target, proof, observation, or plan state is too ambiguous.

### Candidate Set Prepared To Founder Selection Needed

Continue when candidates are specific enough to choose from. Return or stop
when candidates are vague, duplicated, stale, or unsupported.

### Founder Selection Needed To Decision Recorded

Continue when the founder-dev chooses the next treatment. Return or stop when
selection rationale, decision authority, or blocker state is missing.

### Selected To Selection Handoff Produced When Needed

Continue when Delivery needs Discovery context. Return or stop when the
selected Signal is self-contained.

### Decision Recorded To Plan State Refreshed

Continue when the plan map and plan items reflect the decision. Return or stop
when blockers, dependencies, deferrals, selections, closures, or supersessions
remain unrecorded.

### Plan State Refreshed To Closed Or Left Active

Continue when future Discovery can resume cheaply. Return or stop when open
attention is unclear.

## Control Records

Discovery uses Control records to preserve possible-work state:

```text
plan map: current map of possible work and attention.
plan item: one possible-work item, blocker, dependency, deferral, or closure.
selection handoff: context Delivery needs after a selected Signal.
```

Use [control-records/plan-map.md](control-records/plan-map.md) for plan map
rules.

Use [control-records/plan-item.md](control-records/plan-item.md) for plan item
outcomes, roadmap continuity, blockers, dependencies, and possible-work state.

Use [control-records/selection-handoff.md](control-records/selection-handoff.md)
for handoff rules between Discovery and Delivery.

## Candidate Signal Shape

Candidate Signals are temporary review material.

Use a small shape:

```text
candidate Signal
source basis
why useful now
current-state facts used
likely semantic authority involved
candidate discipline package and binding, when material
authority state or freshness issue, when relevant
known unknowns
risk or sensitivity
selection question
```

A candidate becomes the Delivery input only when selected.

## Authority Boundaries

Discovery Control records may:

```text
inform selection
record possible-work state
record selection state that should survive across loops
record blockers and dependencies
record deferrals, selections, rejections, and closure
point to semantic authority, target, proof, observation, and Control records
point to candidate discipline that Delivery should evaluate during Framing
```

Discovery Control records may not:

```text
admit product behavior
replace Intent
replace Assurance
replace Work Boundaries
serve as proof
authorize Build
override current semantic authority
```

Discovery often produces mixed statements. Split them by role.

## Decision Rules

Use these defaults:

```text
continue when Discovery can reduce uncertainty or preserve useful possible-work state
ask when product direction, selection authority, or candidate priority is unclear
select when a candidate is ready for Delivery attention
defer when a candidate is useful but should not control current attention
reject when a candidate should stop drawing attention
block when a candidate needs another decision, fact, or dependency first
close when Discovery state is current and no open Discovery attention remains
leave active when useful Discovery attention remains explicit
```

## Failure Routing

When Discovery cannot move forward:

```text
unclear Direction -> ask a product-shaped question
blocked candidate -> record blocker and unblock condition
dependent candidate -> record dependency
stale authority -> flag currentness issue for Delivery or future Discovery
too many candidates -> ask founder-dev to choose attention
no useful candidate -> close or refresh plans with no selected Signal
selection rationale missing -> return to founder selection needed
handoff context missing -> produce selection handoff before Delivery relies on it
missing live Discovery state -> stop, notify founder-dev of Lifecycle cadence failure, and repair or restart instead of backfilling records
```

## Completion Conditions

Discovery is complete only when:

```text
selected work has a selected Signal, or no selected work is needed
plan map is current when it exists
relevant plan items have current outcomes
blockers, dependencies, deferrals, rejections, and closures are recorded
selection handoff exists when Delivery needs Discovery context
Plan Item, Plan Map, and Selection Handoff state was updated live as selection state changed
open Discovery attention is either closed or explicitly left active
```
