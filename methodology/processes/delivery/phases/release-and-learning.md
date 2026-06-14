# Release and Learning phase

## Purpose

Ship the reconciled result and convert runtime reality into controlled future input.

Use [release summary](../control-records/release-summary.md),
[knowledge promotion decision](../control-records/knowledge-promotion-decision.md),
[archive decision](../control-records/archive-decision.md), and
[closure record](../control-records/closure-record.md) for Delivery Control
records produced in this phase.

Agent may:

```text
prepare release summary as a Control record
use only release and runtime actions admitted by the execution boundary and
observation plan
arm monitors
run canary if needed
watch runtime signals
open incident Signal
propose knowledge promotion
identify durable learning from product judgment, if any
classify discipline promotion candidates
archive non-authoritative notes
mark stale semantic authority if needed
close the active Work Boundary after knowledge promotion decisions
```

Agent must not:

```text
treat runtime data as automatic durable product authority
use runtime data to change behavior without product judgment and admission
hide regressions
silently patch outside the Work Boundary
treat prepared Landing or Closure material as a durable record
skip agent interpretation of prepared material
deploy, rollback, mutate runtime state, or call external systems outside the
execution boundary
move summaries into truth through knowledge promotion
copy generic discipline rules into semantic authority storage without a
product-specific accepted statement
skip rollback planning for risky releases
```

Runtime observations can be interpreted as:

```text
new Signals
Discovery inputs when the next Signal is unclear
incident inputs
supporting proof
learning candidates
archive-only history
not applicable to durable learning
```

Behavior-changing runtime follow-up starts as a Signal. Discovery can select
that Signal when the next action is unclear. Delivery must still weigh product
judgment before behavior-changing follow-up becomes admitted work.

They do not automatically become:

```text
requirements
product policy
architecture authority
```

---

## Knowledge promotion in agent-facing terms

After landing or observing runtime behavior, the agent should ask:

```text
Did we learn anything durable?
If yes, where does it belong?
```

Knowledge promotion targets:

```text
Context: product meaning, users, market, business constraints, strategy.
Intent: behavior, acceptance checks, non-goals.
Assurance: invariant or non-functional obligation.
Blueprint: architecture, state, sequence, dependency structure.
Description: local implementation meaning.
Archive: useful history, not authority.
```

The agent may propose knowledge promotion.

It may not silently move its own summary into durable truth through knowledge
promotion.

A promotion proposal should name:

```text
target semantic authority surface
target entry or new entry
intended entry state
source proof, observation, founder decision, or Control record
source product judgment when it contains durable learning
discipline usage record when it created the candidate
related semantic authority entries
product meaning to write
source material to leave outside semantic authority storage
```

---

## Learning classification

Classify each learning candidate before closure:

```text
durable product meaning -> knowledge promotion decision and semantic authority update
behavior-changing follow-up -> new Signal
useful history only -> archive decision
process-state learning -> Control record or closure record
product judgment learning -> knowledge promotion when durable, otherwise closed Work Boundary process state
discipline candidate -> product-specific promotion decision or rejection
proof support -> Evidence Packet
raw runtime fact -> observation until interpreted
no durable learning -> mark not applicable
```

The promotion decision should explain what was rejected or archived as directly
as it explains what was promoted. This prevents semantic authority storage from
becoming a second transcript while still keeping future agents from losing
durable learning.

When learning is promoted, update the owning semantic authority surface through
`semantic-authority/update-product-meaning.md`. When learning is rejected or archived,
record the reason in the knowledge promotion decision or archive decision and
leave semantic authority storage unchanged.

---

## Closure gate

Release and Learning exits to Delivery closure only when:

```text
landing or abandonment is resolved
product judgment is satisfied, superseded, abandoned, or kept as closed process state
runtime exposure is handled or not applicable
runtime outputs are classified when present
learning candidates are promoted, rejected, archived, deferred, or not applicable
release summary exists when release exposure matters
knowledge promotion or archive decisions exist when needed
closure record is ready
```
