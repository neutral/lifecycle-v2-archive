# Build phase

## Purpose

Implement inside the active Work Boundary.

Agents may write normal code.

The Build phase does not require a predefined transformation substrate.

Agent may:

```text
run the bound Required Checks of in-slice entries before the first edit, as
the no-pre-existing-breach baseline; route a pre-existing red as its own
Signal unless the active Work Boundary admits the repair
edit code inside allowed change surfaces
use only tools, environments, credentials, external systems, and runtime
operations admitted by the execution boundary
update relevant Description entries
preserve semantic authority references when implementation-local meaning changes
add tests
use existing project conventions
use existing scaffolds or generators if available
update target-specific ignore rules for generated local artifacts when needed
preserve admitted discipline constraints
record discoveries
update the Work Boundary when discoveries affect product judgment, scope,
change surfaces, discipline, execution boundary, or proof obligations
update the Evidence Packet when proof obligations, proof commands, proof gaps,
or declared non-change checks become concrete
raise decisions when discoveries change authority or risk
raise decisions when discoveries falsify or materially change product judgment
narrow implementation when needed
prepare work delta
```

Agent must not:

```text
touch restricted change surfaces without admission
begin substantive edits without an active Work Boundary and live Evidence
Packet when proof obligations exist or proof will be needed
use tools, credentials, external systems, runtime operations, deployments, or
destructive actions outside the execution boundary
add unadmitted behavior
continue when product judgment is missing, under-specified, or falsified
silently expand scope
edit generated code directly unless admitted
change auth/billing/permissions/data isolation casually
treat implementation convenience as product authorization
let implementation convenience replace product judgment
update semantic authority to justify unadmitted code after the fact
ignore discipline Build guardrails
```

If Build has already started without the required live Control cadence, stop
and notify the founder-dev. Do not continue by creating end-of-run Control
records that imply Build was controlled.

Build output:

```text
work delta
updated Description entries where needed
tests and checks
recorded discoveries
change surface map
ignored or removed generated local artifacts
```

The work delta is the changed set being landed. Evidence Packets and Landing
Packets are Control records, not part of the work delta they describe or prove.

Build exits to Evidence and Reconciliation only when:

```text
actual touched surfaces are known
work delta is ready to freeze for proof
declared non-changes can be checked
execution actions used are known
admitted discipline constraints are preserved or routed back to Framing
product judgment still matches the work delta or is routed back to Framing
semantic authority update obligations are known
generated local artifacts are ignored or removed from the landing
```

---

## Build discoveries

When the agent discovers new work, classify it:

- Inside active Work Boundary: continue and record.
- Outside but required: pause and propose a fresh child Work Boundary or a new
  higher-tier Work Boundary.
- Outside and optional: defer and record as a declared non-change.
- Restricted: stop and raise the decision.
- Outside execution boundary: stop and raise the decision.
- Contradicts authority: resolve authority before continuing.
- Contradicts product judgment: return to Framing before continuing.
- Falsifies product judgment: revise, split, defer, or abandon before continuing.
- Introduces material discipline: return to Framing before continuing.
- Changes selected discipline classification: return to Framing before continuing.
- Requires sensitive area: require explicit admission.
- Requires semantic authority change: update through the correct semantic
  authority home, active Work Boundary obligation, or knowledge promotion path.

Use a child Work Boundary when discovered work is required but outside the
parent Work Boundary and the current Delivery should resume after the child work
lands or is abandoned.

Keep optional discoveries as declared non-changes or Discovery plan items
unless the current Delivery run admits them.

A parent Work Boundary cannot become landing ready until:

```text
required child Work Boundaries are landing ready, landed, abandoned, or
explicitly deferred according to the parent resume condition
optional discoveries are deferred
forbidden or unwanted changes are removed
proof obligations are satisfied
proof is current against the final work delta
required Control records are produced
product judgment still holds
```

Example:

```text
Discovered:
Invite acceptance is needed to complete the full invite journey.

Classification:
Outside active Work Boundary.

Reason:
It changes membership state and possibly role/billing behavior.

Options:
1. Keep current landing limited to invite creation.
2. Create child Work Boundary for invite acceptance.
3. Stop and start a new higher-tier Work Boundary.
```

---

## Description sync during build

Description sync is not mandatory for every file edit.

It is required when implementation-local meaning changes.

Update Description when:

```text
module responsibility changes
new invariant is introduced
forbidden responsibility becomes relevant
sensitive dependency changes
future modification guidance changes
local code behavior diverges from description
```

Do not update Description merely to restate a mechanical diff.

Good Description update:

```text
Invite Service now owns duplicate pending invite reuse.
It still does not own invite acceptance or billing seat allocation.
```

Bad Description update:

```text
Line 42 now calls createInvite instead of buildInvite.
```

---
