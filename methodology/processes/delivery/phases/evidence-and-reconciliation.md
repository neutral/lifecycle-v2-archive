# Evidence and Reconciliation phase

## Purpose

Prove and reconcile the result before landing.

Evidence Packets and Landing Packets are produced inside the active Delivery
run. They are not contents of the Work Boundary itself. The Work Boundary gives
permission, admitted scope, and execution boundary. The Evidence Packet proves
the final work delta. The Landing Packet records the release or merge handoff
after reconciliation.

The Evidence Packet should already exist as live proof state when proof
obligations were concrete before Build. Evidence and Reconciliation updates
that packet for the frozen final work delta; it does not reconstruct the whole
proof story for a run that lacked live Evidence state.

Use [Evidence Packet](../control-records/evidence-packet.md) and
[Landing Packet](../control-records/landing-packet.md) for Delivery Control
record contracts.

An Evidence Packet answers:

```text
Did the final work delta match the admitted product judgment?
Did the admitted behavior work?
Were the product judgment tradeoffs, exclusions, and falsifiers checked?
Were proof obligations satisfied?
Were declared non-changes preserved?
Were assurances satisfied?
Were restricted change surfaces avoided?
Was the execution boundary followed?
Were discipline proof obligations satisfied?
Are semantic authority update obligations reconciled and current?
Are required Control records produced?
Is the proof current?
Did the actual work delta match the active Work Boundary?
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

Agent may:

```text
run tests
add acceptance checks
re-run the bound Required Checks of touched entries against the final work
delta and refresh their last_held lines
reference standing Required Checks as evidence for the proof obligations they
cover
check permissions/security invariants
compare actual diff to the active Work Boundary
compare actual behavior to the admitted product judgment
check execution boundary compliance
check semantic authority freshness
check semantic authority entry state, scope, and update obligations
check discipline obligations and `disciplines_used`
detect stale proof
interpret proof receipts when tooling is present
interpret findings when tooling is present
interpret prepared Evidence material when tooling is present
assemble an Evidence Packet as a Control record
raise mismatch
```

Agent must not:

```text
reuse stale proof
create the first Evidence Packet only at the end of a run when proof
obligations were concrete before Build
ignore failed or missing checks
ignore product judgment tradeoffs, exclusions, or falsifiers
declare landing readiness despite unadmitted behavior
claim restricted change surfaces were untouched without checking
claim execution boundary compliance without checking side-effecting actions
treat tests as sufficient when behavior was not admitted
treat tests as sufficient when they prove implementation behavior but not the
admitted product judgment
ignore conflicting semantic authority
ignore selected discipline obligations
treat a proof receipt as an Evidence Packet
treat prepared Evidence material as an Evidence Packet
skip agent interpretation of tool observations
```

If the first Evidence Packet appears only after implementation is complete,
stop and notify the founder-dev unless the active Work Boundary already
recorded why live proof tracking was not applicable before Build.

## Reconciliation checks

Before landing, compare:

```text
active Work Boundary vs actual work delta
product judgment vs actual behavior and final work delta
allowed change surfaces vs touched change surfaces
restricted change surfaces vs touched change surfaces
execution boundary vs used tools and side-effecting actions
declared behavior vs implemented behavior
declared non-changes vs actual diff
assurances vs Evidence Packet
semantic authority update obligations vs semantic authority entry state
semantic authority slice vs entry state, scope, and supersession
discipline obligations vs Evidence Packet
discipline usage vs active Control records
Control record requirements vs produced Control records
bound Required Checks of touched entries vs last_held currency and Evidence
Packet references
proof obligations vs Evidence Packet
product judgment proof consequences vs Evidence Packet
proof obligation ids vs Evidence Packet coverage
authority source versions vs current discipline sources
tested commit, version, or local final work delta vs final landing reference
observation plan vs release risk
```

An Evidence Packet is durable proof. A closed Work Boundary is a Control record
scoped to that Delivery run, not durable product authority. The packet should
preserve what was checked, which commit was tested, and which admitted behavior
was proven without requiring future agents to treat a closed Work Boundary as
current authority.

Possible outcomes:

- Landing ready: actual work matches the active Work Boundary, and proof is
  current.
- Product judgment satisfied: actual work matches admitted behavior, tradeoffs,
  exclusions, and falsifiers.
- Product judgment mismatch: actual work satisfies local checks but contradicts
  the admitted tradeoff or exclusion.
- Proof obligation unsatisfied: work may be valid, but one or more proof
  obligations lack satisfying evidence.
- Semantic authority sync required: Context, Intent, Assurance, Blueprint, or
  Description is stale, missing, or conflicting.
- Discipline proof required: selected discipline created proof
  obligations that lack satisfying evidence.
- Semantic authority update required: entry state, scope, or related semantic
  authority changed.
- Target mismatch required: Code or deployed executable behavior differs from
  admitted meaning.
- Proof refresh required: evidence exists, but it is stale against the final
  work delta.
- Control record required: a required Evidence Packet or Landing Packet is
  missing.
- Rescope required: actual work includes unadmitted behavior or change surfaces.
- Execution boundary decision required: the work used or needs an action outside
  the admitted execution boundary.
- Revert required: forbidden or unwanted change appeared.
- Founder decision needed: strategic, semantic authority, target, proof,
  observation, or risk decision is unresolved.

Evidence and Reconciliation exits to landing readiness only when:

```text
Evidence Packet covers the final work delta and admitted product judgment
Evidence Packet records exact proof commands and runtime names
proof obligations are satisfied or explicitly handled
discipline obligations are satisfied or explicitly rejected
proof is current
actual work matches the active Work Boundary
actual work matches the admitted product judgment
required Control records are present
observation plan is ready when needed
```

---
