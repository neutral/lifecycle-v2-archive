# Clarity Process

## Purpose

Use this page to run one Clarity process from Context pressure to Context
closure.

Clarity turns a bounded Context problem into coherent Context authority and
founder-reviewable recommendations. It does not admit behavior, authorize Build,
prove a Delivery work delta, select the next Signal automatically, or start
another process. It does not automatically start Discovery or Delivery.

## Start Conditions

Start Clarity when Context work is the work:

```text
founder-dev asks a broad product meaning question
Context corpus needs atlas structure, review, or canonicalization
Context entries conflict, duplicate, drift stale, or lack retrieval routes
promotion pressure toward narrower semantic authority surfaces needs review
Discovery or Delivery cannot proceed safely because Context is too sparse
```

Use [Discovery](../discovery/process.md) when the main question is what work to
select next.

Use [Delivery](../delivery/process.md) when a concrete Signal should be admitted
into bounded production change.

## Live Control Cadence

Clarity Control records are live process state. They are not notes to write
after the Context edit is done.

Before making substantive Context edits, Clarity must have an active Clarity
Boundary. When route, content, canonicalization, promotion, or retrieval checks
will be needed, create or update the Context Review Packet before those edits
depend on the checks.

If Context edits already happened without the live Clarity Boundary and review
cadence, stop, notify the founder-dev that Lifecycle cadence failed, and repair
or restart instead of reconstructing records at closure.

## Inputs

Clarity reads across Lifecycle roles:

```text
current Context entries
other semantic authority entries when they depend on or pressure Context
source material
target facts only when they affect Context meaning
proof and observations only when they explain durable product posture
prior Control records only by explicit pointer, audit need, or source treatment
founder-dev input
```

Clarity must classify each source's authority treatment. Old source structure,
process history, proof status, and tool findings do not become Context merely
because they were read.

## Context Contract

Clarity operates against the Context surface contract. The Context surface
defines owned meaning, atlas fields, relationship direction, review/freshness
authority limits, and the route-review/content-review invariant. Clarity does
not redefine those semantics; it controls the work that applies them.

Use Clarity records for process state:

```text
what source material was read
what scope was admitted
what checks were run
what route, content, canonicalization, promotion, and retrieval decisions were
made
what recommendations remain for founder-dev inspection
```

Use Context entries for product meaning:

```text
current rationale, direction, users, market, constraints, product posture,
area routes, canonical references, freshness policy, and promotion pressure
```

## Process State Machine

Clarity moves through these process states:

```text
no active Clarity
-> Clarity active
-> Source Inventory current
-> Context Review Packet active
-> Context updates made
-> retrieval proof complete
-> Clarity closed with recommendations
```

Each state has one controlling question and one exit condition.

### No Active Clarity

The controlling question is whether Context pressure is the work. Clarity
starts only when the semantic layer needs focused maintenance.

### Clarity Active

The controlling question is what Context scope and review depth are admitted.
This state exits when the Clarity Boundary is active and explicit.

### Source Inventory Current

The controlling question is what material exists and how each source should be
treated. This state exits when source material, current Context, stale or
duplicate candidates, conflicts, and suspected canonical references are
classified enough for the review depth.

### Context Review Packet Active

The controlling question is what checks must control route, content adequacy,
canonicalization, promotion pressure, and retrieval. This state exits when the
Context Review Packet names the checks and can track results live.

### Context Updates Made

The controlling question is which Context entries should be created, updated,
superseded, deferred, or left unreviewed. This state exits when updates match
the Clarity Boundary and review depth.

### Retrieval Proof Complete

The controlling question is whether a future agent can retrieve the smallest
useful Context slice without reading the whole corpus. This state exits when
route, ID uniqueness, overview, relation, freshness, and promotion-pressure
checks are recorded or explicitly blocked.

### Clarity Closed With Recommendations

The controlling question is whether any active Clarity state remains. Clarity
closes when Context updates, unresolved gaps, recommendations, and the
no-auto-start outcome are recorded.

## Normal Path

Use this order:

```text
1. Identify the Context pressure.
2. Create or update the Clarity Boundary with scope, review depth, allowed
   Context mutations, exclusions, and closure condition.
3. Build the Source Inventory.
4. Retrieve the smallest current Context slice needed for the pass.
5. Create or update the Context Review Packet.
6. Review atlas route, content adequacy, canonicalization, promotion pressure,
   and retrieval according to the Boundary.
7. Update Context entries, review/freshness labels, relations, and promotion
   pressure inside admitted scope.
8. Record stale, duplicate, conflict, supersession, or deferred treatment.
9. Prove retrieval: IDs, routes, overviews, canonical references, and smallest
   sufficient slice.
10. Write the Clarity Closure Record.
11. Stop with recommendations; do not start Discovery or Delivery.
```

## Authority Boundaries

Clarity may update Context. It may reference downstream surfaces when Context
depends on or pressures them. It must not replace those downstream surfaces.

Clarity records promotion pressure when meaning belongs in Intent, Assurance,
Blueprint, or Description. It does not silently update those surfaces or treat
Context pressure as sufficient authority for them.

Clarity may recommend:

```text
start Discovery to choose among candidate Signals
start Delivery for a concrete candidate Signal
run another Clarity pass for a different cluster
promote meaning into another semantic authority surface
ask the founder-dev for a product decision
defer because Context cannot be made current yet
```

Those recommendations are process state. The founder-dev decides what process
starts next.
