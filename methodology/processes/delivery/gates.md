# Delivery Gates

## Purpose

Use this page to decide whether one Delivery state may advance to the next.

The Delivery process defines the state machine. Gates make the transition
checks mechanical enough for repeated agent use.

## Enter Delivery

Enter Delivery only when a concrete Signal exists.

Required context:

```text
source Signal
known Discovery selection handoff, when relevant
obvious product area or target surface
current active Delivery records, when any exist
```

Continue when the Signal is concrete enough to interpret.

Route to Discovery when useful work is unclear, selection is unresolved, or the
prompt asks what to do next.

## Before Work Boundary Active

Create or confirm the active Work Boundary before substantive repository edits.

Required record:

```text
records/control/delivery/work-boundaries/wb.<run-id>.md
```

Required fields:

```text
tier
source Signal
selected meaning
product judgment
recommendation basis
admitted scope
target change surfaces
execution boundary
proof obligations
semantic authority update obligations
discipline usage when selected
Control record requirements
landing readiness rule
```

Each proof obligation should name:

```text
id
claim
source
expected evidence
freshness condition
failure response
```

Continue when selected meaning is admitted into the active Work Boundary and
the Work Boundary is complete for its tier.

Stop when meaning, product judgment, authority, risk, tier, execution boundary,
or proof is unclear.

Stop when product judgment is missing, under-specified, unsupported by current
repo state, or hidden inside recommendation basis. Conversation framing may
identify hypotheses, but code, tests, contracts, docs, current records,
installed methodology, and relevant semantic authority control the product
judgment.

Stop when the recommendation basis is missing or unsupported by current repo
state. The basis must support the product judgment, tier, surfaces, execution
boundary, proof obligations, and update obligations.

If substantive edits already happened without an active Work Boundary, stop and
notify the founder-dev immediately. Do not proceed by reconstructing the Work
Boundary as if it had controlled the edits.

## Before Build Active

Build can begin only inside the active Work Boundary.

Check:

```text
the active Work Boundary is current
product judgment states admitted behavior, why now, tradeoff, exclusions,
falsifiers, and proof consequences at the depth required by risk
recommendation basis is sufficient for the Signal's risk and ambiguity
strategy-shaped work states the intended agent outcome before implementation scope
changed recommendations include old recommendation, new evidence, changed
premise or tradeoff, new recommendation, and unchanged tradeoffs
changed product judgments include old judgment, new evidence, changed premise
or tradeoff, new judgment, and unchanged tradeoffs
semantic authority slice is sufficient or marked new/not yet present
any semantic_authority_backpressure blocker is resolved or explicitly not applicable
material discipline is selected, rejected, or marked not applicable
selected discipline constraints, conflicts, and proof effects are recorded
earlier semantic authority is sufficient for each later surface or
implementation step the work depends on
Context is sufficient when product direction, dependency basis, user value, or
release posture shapes the work
Intent is sufficient when behavior, non-goals, or acceptance meaning shape work
Assurance is sufficient when invariants, risk, or checks shape the work
Blueprint is sufficient when structure, state flow, dependency direction, or
boundaries shape the work
Description is sufficient when local responsibility or sensitive edges shape work
target change surfaces are allowed
restricted surfaces are identified
execution boundary admits the tools and side effects needed
proof obligations are specific enough to guide Build, Evidence and
Reconciliation, product judgment validation, and failure routing
active Evidence Packet exists for the run when proof obligations exist or proof
will be needed before landing
```

Continue when Build can stay inside the active Work Boundary.

Stop and reframe when Build needs new behavior, new surfaces, restricted
surfaces, broader execution, a higher tier, or earlier semantic authority that
is too sparse to guide the admitted work.

Stop and reframe when Build discovers facts that falsify or materially change
the product judgment.

Stop and reframe when material discipline is unresolved, conflicts with
the admitted work, or creates proof obligations that are not in the active Work
Boundary.

Stop and reframe when a recommendation rests on conversation framing instead of
repo state, collapses distinct roles without inventory, hides assumptions, or
changes direction without a recommendation delta.

Stop and reframe when product judgment rests on conversation framing instead of
repo state, fails to name exclusions, ignores nearby alternatives, or changes
without a judgment delta.

Stop and notify the founder-dev when Build edits have already happened without
the active Work Boundary and Evidence cadence. This is a Lifecycle process
failure, not a missing-form problem.

## Before Final Work Delta Frozen

Freeze the work delta when implementation appears complete and ready for proof.

Check:

```text
active Evidence Packet has tracked the run's proof obligations or records why
live proof tracking was not applicable before Build
actual touched surfaces are known
generated local artifacts are ignored or removed
declared non-changes can be checked
execution actions used are known
semantic authority update obligations are still current
admitted discipline constraints are preserved or routed back to Framing
product judgment still matches the work delta or is routed back to Framing
no new unadmitted behavior remains in the diff
```

Continue when the work delta can be treated as the proof target.

Return to Build when the work still changes. Return to Framing when the delta
does not fit the active Work Boundary.

## Before Evidence Produced

Update the live Evidence Packet for the frozen work delta.

Required record:

```text
records/control/delivery/evidence/evidence.<run-id>.<version>.md
```

Required proof content:

```text
final work delta pointer
tested commit, version, or local final work delta label
proof obligations covered
proof obligation ids covered
exact proof commands and runtime names
proof receipt references, when used
runtime construction or startup proof when the admitted behavior depends on it
declared non-change evidence
discipline evidence when selected discipline created proof obligations
freshness status
reconciliation result or pending reconciliation state
open proof gaps and their failure responses, when present
```

Continue when each proof obligation has evidence or a recorded proof gap.

Stop when the Evidence Packet was missing during substantive Build work, proof
commands are unknown, proof is stale, or the final work delta changed after
proof.

A proof obligation may be satisfied by a standing Required Check bound to a
governing semantic authority entry when the check's registered command ran
fresh against the final work delta. The Evidence Packet references the check
and interprets its coverage; obligations no standing check covers keep their
own evidence.

When the changed behavior depends on a runtime surface being constructed,
loaded, started, or invoked, proof should include a shallow runtime smoke. The
smoke should cover construction or startup, one minimal admitted path when
feasible, and clean exit or shutdown. When the target registers a bring-up
proof command that starts the product in its declared local environment, use
that command as the smoke instead of an ad hoc invocation, and treat its
absence for runtime-dependent work as a proof gap to record.

## Before Reconciled

Reconcile actual work against the active Work Boundary.

Check:

```text
actual behavior matches selected meaning
actual behavior matches product judgment
actual touched surfaces match allowed surfaces
restricted surfaces were not touched without admission
declared non-changes were checked
execution boundary was followed
semantic authority update obligations are satisfied, unnecessary, blocked, or deferred
discipline obligations are satisfied, explicitly rejected, or routed back
to Framing
semantic_authority_backpressure is resolved or explicitly not applicable
later surfaces and implementation did not carry meaning owned by earlier surfaces
required Control records exist or are explicitly not applicable
Evidence Packet covers the product judgment proof consequences
```

Continue when mismatches are resolved.

Stop when the actual work delta includes unadmitted behavior, missing proof,
unresolved semantic authority obligations, or hidden earlier semantic authority
in a later surface or implementation.

Stop when the actual work delta contradicts the product judgment, violates an
explicit exclusion, or satisfies implementation checks while falsifying the
accepted tradeoff.

Stop when selected discipline creates unresolved constraints, proof gaps,
or conflicts.

## Before Landing Ready

A Delivery run is landing ready only when proof, product judgment coverage, and
reconciliation are current.

Required records:

```text
active Work Boundary
Evidence Packet
```

Continue when:

```text
Evidence Packet covers the final work delta and admitted product judgment
proof is current against the final work delta and admitted product judgment
declared behavior and non-changes were checked
product judgment, tradeoffs, exclusions, and falsifiers were checked
semantic authority update obligations are resolved or carried forward
discipline obligations are satisfied or explicitly handled
landing handoff can be stated
```

Stop when proof is stale, the Work Boundary changed, the work delta changed, or
landing handoff is unclear.

## Before Landed or Abandoned

Create the Landing Packet when the work is landing ready.

Required record:

```text
records/control/delivery/landings/landing.<run-id>.md
```

Continue when the Landing Packet points to current evidence and records merge,
release, or abandonment handoff. The Landing Packet may be closed after the
handoff is recorded while its `landing_state` records the outcome. If the final
landing commit or version exists, the Landing Packet records it. If the Landing
Packet lands in the same commit as the code, the handoff reference may say that.

Stop when the handoff authority is unclear, the final proof target changed, or
release exposure requires a decision not admitted by the execution boundary.

## Before Runtime and Learning Resolved

Handle runtime exposure and learning after landing or abandonment.

Create these records when needed:

```text
records/control/delivery/releases/release.<run-id>.md
records/control/delivery/promotions/promotion.<run-id>.<slug>.md
records/control/delivery/archives/archive.<run-id>.<slug>.md
```

Continue when runtime outputs are classified and learning is promoted,
rejected, archived, deferred, or marked not applicable.

Stop when runtime response, incident handling, rollback, observation, or
knowledge promotion remains unresolved.

## Before Closed

Create the closure record before marking Delivery complete.

Required record:

```text
records/control/delivery/closures/closure.<run-id>.md
```

Delivery closes only when:

```text
landing or abandonment is resolved
runtime exposure is handled or not applicable
learning is promoted, rejected, archived, deferred, or not applicable
semantic authority update obligations are resolved or carried forward
discipline usage is recorded or explicitly not applicable
active Work Boundary is closed
records that remain active are named
closed records are off by default
next retrieval pointer exists when follow-up remains
```

Stop when any active, blocked, deferred, landing-ready, or landed state is not
recorded.
