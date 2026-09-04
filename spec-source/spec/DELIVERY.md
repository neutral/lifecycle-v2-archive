# Lifecycle Delivery

> Status: Draft

## Purpose

This document defines Delivery, the sole Lifecycle Process. One Delivery
governs one bounded product result from one fresh Founder Brief through an
accepted canonical result or an authenticated no-ship disposition.

Delivery owns operation eligibility, the sole legal event reduction, Work
Boundary standing, Candidate continuity, Material Condition handling,
Founder-authorized transactions, exact recovery, Closure, and terminal store
disposition. It does not own durable Product Knowledge, Atlas, provider
reasoning, repository Check mechanisms, or release and deployment after
acceptance.

[Atlas Integration](ATLAS.md) owns Delivery's mandatory read-only Atlas
boundary. Each active Work Boundary consumes one complete valid admitted Atlas
snapshot and Delivery can never create or change an Atlas path.

[Control](CONTROL.md) owns the Delivery Control Record Store, common revision
lifecycle, record-family and relationship registry, event integrity, sealing,
and archive. [Processing](PROCESSING.md) owns canonical values, logical digests,
and event processing. [Execution](EXECUTION.md) owns the subordinate Backend,
Cell, Carrier, Containment, Retirement, and Reclamation contracts. [Agent
Attempts](ATTEMPTS.md) owns provider execution, governed Agent Markdown,
Candidate advancement, and Execution Receipts.
[Attempt View](ATTEMPT_VIEW.md) owns the derived post-Attempt dossier.
[Evidence](EVIDENCE.md) owns Check, Seal, review, and Evidence Packet meaning.
[Authority](AUTHORITY.md) owns authentication.

## Requirement Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative only when they appear in uppercase. Their meanings
follow BCP 14.

## Foundation rc.10 Cut

Delivery rc.10 is selected only with this coordinated fresh Foundation set:

<!-- markdownlint-disable MD013 -->

| Coordinate | Selected value |
| --- | --- |
| Qualification revision | `lifecycle.foundation.1.0.0-rc.10` |
| Repository contract | `lifecycle.repository.v15` |
| Runtime protocol | `lifecycle.runtime.foundation.v10` |
| Interface protocol | `lifecycle.interface.foundation.v10` |
| Provider adapter | `lifecycle.provider-adapter.v6` |
| Control Store | `lifecycle.control-record-store.v1` |

<!-- markdownlint-enable MD013 -->

An rc.10 runtime applies the coordinated unsupported-carrier refusal owned by
[Control](CONTROL.md#foundation-rc10-hard-cut) and
[Evolution](EVOLUTION.md#fresh-only-hard-cut).
Export similarity and matching display text do not create compatibility.

No unsupported coordinate has compatibility, migration, recovery, or
publication standing.

The package version remains `1.0.0`. No package label substitutes for the exact
coordinates above.

## Process Invariant

Delivery preserves this invariant:

> Productive work can become canonical only when it remains inside one
> Founder-admitted Work Boundary and the exact sealed result satisfies every
> required obligation under independent Evidence.

The integrated route is:

```text
fresh Founder Brief
  -> reconnaissance Attempt and Agent Work Product
  -> runtime-compiled Work Boundary Revision
  -> exact modality-valid baseline Check Receipts
  -> Founder-authenticated admission transaction
  -> applied observation makes the same Boundary active
  -> exact initialization observation creates one Candidate
  -> independently funded builder Attempts on that Candidate
  -> continue, correct, or resolve a Material Condition
  -> exact Candidate Seal, final Checks, and independent review
  -> Evidence Packet
  -> Founder-authenticated acceptance or no-ship transaction
  -> Candidate treatment, execution Containment and Retirement, and Closure
  -> sealed and archived Control Record Store
  -> bounded installation-private backend Reclamation
```

No-ship can branch from every explicitly eligible standing and does not require
an Evidence Packet. A failed preparation can also close through authenticated
no-ship without inventing a Work Boundary or Candidate.

Ordinary edits, tests, commands, provider turns, and Agent reasoning are work
inside an activity. They are not Delivery states or Journal events. A durable
transition is required when the active mandate, Candidate subject, Evidence
subject, Founder authority, canonical product state, or exact recovery
coordinate changes.

## One Fresh Delivery

One `delivery.prepare` request creates one fresh Delivery identity and one new
Control Record Store. It finalizes one complete self-contained Founder Brief
and starts exactly one preparation activity. That Delivery never inherits a
Brief, Work Boundary, Agent summary, TUI transcript, provider conversation, or
hidden Process state from another Delivery.

A later fresh reconnaissance request creates another Delivery and store. It
does not append a second preparation activity to an existing Delivery or
replace that Delivery's proposal. Several fresh Deliveries MAY prepare in
parallel for one target, including while another Delivery has an active
Candidate. Their stores, events, records, activities, locks, Candidates, and
authority subjects remain distinct. Preparation holds no canonical branch
lease. Within one installed Lifecycle machine custody, at most one admitted,
unclosed Delivery may hold that lease for one target and canonical branch.
Initial admission refuses while another retained Store holds it. A prepared
proposal whose exact branch commit or tree moved is stale and cannot be
admitted; retry requires a fresh Delivery.

Every operation after creation names one exact existing Delivery through the
runtime protocol. A target locator alone MUST NOT select whichever Delivery is
newest. The runtime exposes the target-scoped Delivery Inbox defined by
[Control](CONTROL.md#delivery-inbox). It cannot merge or transfer Process state,
and selecting one row names that exact Delivery rather than ambient recency.

An unsuccessful preparation remains an open Delivery until the Founder either
invokes its eligible no-ship operation or leaves it unfinished. The runtime
MUST NOT manufacture Closure, delete the store, or silently reuse its Brief in
another Delivery.

## Work Boundary

The Work Boundary is one complete immutable mandate revision. Revision `1` is
compiled from the Delivery's Founder Brief, reconnaissance Work Product, exact
repository and Knowledge observations, and runtime rules. A later revision is
compiled only to resolve one exact Material Condition.

The Work Boundary record owns its complete typed facts and readable semantics.
It is not split into Preparation, Proposal, and admitted copies. Proposed,
admission-ready, active, superseded, and unselected are reducer-derived
standings over the same immutable revision.

### Identity and revision

An initial Work Boundary:

- has revision `1` of one stable Boundary identity;
- relates to exactly one Founder Brief and one reconnaissance Work Product;
- has no predecessor or Material Condition; and
- is finalized before its baseline Checks run.

A revised or reaffirmed Work Boundary:

- uses the same Boundary identity and exactly the next revision;
- relates to the exact active predecessor and Material Condition;
- binds the current Candidate without changing its identity or immutable base;
- freshly reproduces the same admitted repository, Atlas, and Knowledge basis;
- records the exact Founder resolution rationale supplied to the operation;
  and
- receives a fresh complete baseline Check set.

Historical revisions remain immutable and addressable. A later revision does
not become active until its exact readmission transaction is observed applied.
Readmission may change or reaffirm the mandate but cannot replace the active
Delivery's repository or Atlas epoch. Newer Atlas meaning is available only to
a fresh Delivery prepared after the active lease closes and that Atlas change
lands on the canonical branch.

### Basis and mandate

Each revision binds at least:

- target, Delivery, repository contract, specification, compiler, and rule
  coordinates;
- canonical product-base commit and tree;
- Product State, repository-contract, Knowledge Set, and the direct Atlas basis
  fields `atlasStateDigest`, `atlasResolutionDigest`,
  `atlasNormalizedModelDigest`, and `atlasResourceBindingsDigest`;
- every selected Knowledge identity, revision, source digest, and semantic
  digest;
- every required exact external source revision or digest;
- selected Capability Profile and Execution Projection profile;
- Check Definition and Binding set;
- selected product meaning and why the result matters now;
- included and excluded outcomes;
- authority facts, chosen tradeoffs, assumptions, and falsifiers;
- product effects and risks;
- obligations and required artifacts;
- Check selections and temporal modalities; and
- acceptance propositions.

The mandate describes one assessable result. It MUST NOT prescribe a serial
implementation itinerary, tool sequence, model plan, invocation count, or
provider session.

Every required Behavior, Assurance, applicable Blueprint constraint,
Description obligation, effect, risk, artifact, Check, exclusion, and
acceptance proposition has an exact boundary-local identity and complete
coverage. Required artifacts use normalized repository-relative paths and
state their semantic role and required final disposition. Product effects do
not grant builder capability.

An Obligation source may name selected Knowledge, a selected exact external
source, or the exact boundary-local mandate direction. The mandate direction is
already exactly bound by the Work Boundary. An active Boundary is selected by
an authenticated Founder Decision. The direction does not become a Knowledge
or external-source root. No other boundary-local fragment is an Obligation
source.

### Baseline Checks and proposal readiness

The runtime finalizes the Work Boundary before executing baseline Checks so
every Check Receipt can reference the exact revision it checked. The Boundary
MUST NOT point forward to future Receipts.

Each selected baseline Check produces one truthful `check-receipt` revision
when it runs. Proposal readiness is derived only when:

- the complete required Check and Binding set has one exact Receipt per
  required execution;
- every Receipt references the same Work Boundary revision;
- every baseline disposition is legal for its selected temporal modality and
  every admission-gating baseline obligation is satisfied under the selected
  rc.10 profile;
- execution conditions, subject identity, Containment, and Retirement validate;
  and
- the preparation activity completes successfully.

The mandate MUST select at least one baseline-required Check and at least one
final-required Check. Preparation therefore requires at least one baseline
Check Receipt, while evaluation can always reach a nonempty exact final Check
set. Preconditions and regression guards require a pass. A repair target may
retain its expected baseline fail, and a postcondition may retain its
modality-required `not-run`; neither is coerced into a pass. A
modality-illegal, unsupported, operational-error, missing, foreign, or stale
admission-gating Receipt leaves the Boundary retained but unselected and the
preparation unsuccessful. An Agent claim cannot supply readiness.

The successful preparation activity selects its exact Boundary as the sole
proposed admission subject. Founder authentication selects those same bytes;
admission does not copy or recompile them.

## Candidate Continuity

The Candidate is Delivery's sole reversible development product-state object.
It is not a Control record, physical worktree, Execution Cell, or second
Process. Continuity consists of the reducer-selected Candidate Revision and its
exact Candidate Revision Carrier.

Initial admission follows this exact order:

```text
Founder Decision authenticated
  -> admission effect intent durable
  -> exact admission effect observed applied
  -> initial Carrier manifest and complete Git object closure published
  -> initial Candidate Revision retained and observed
  -> admission activity complete
```

Productive work MUST NOT start before this sequence succeeds. Admission failure
before the applied observation leaves no Candidate. Recovery after an applied
observation resumes only publication and selection of the one exact initial
Carrier and Revision for that same Decision and base. It cannot allocate a
productive Cell or choose another base.

Applied readmission follows the same post-effect discipline without changing
Candidate product bytes:

```text
readmit Decision authenticated
  -> readmission effect intent durable
  -> exact readmission effect observed applied
  -> successor Work Boundary activated
  -> successor Candidate Revision rebound to that Boundary using the exact
     current Carrier
  -> readmission activity complete
```

The rebind revision keeps the same Candidate record identity and
`candidateBaseCommit`, advances exactly one revision, `revises` the previously
current Candidate Revision, is `governed-by` the newly active successor
Boundary, and binds the byte-identical Carrier. Recovery after the applied
observation cannot complete readmission or compile continue context until that
exact revision is durable.

The Candidate identity and `candidateBaseCommit` never change during the
Delivery. A builder Attempt receives the exact current Revision and Carrier in
one immutable Execution Input Set. Its Cell materialization and writes remain
provisional; they do not mutate the Candidate directly.

After Containment, the runtime retrieves the complete Output Carrier and
Manifest, independently validates their inventory and bytes, imports the exact
Git tree, rejects Atlas or Control changes and every other repository-invalid
state, and publishes the complete content-addressed Candidate Revision Carrier.
Only then may one atomic Control transition retain and observe the next
`candidate-revision` under the stable Candidate identity. An unchanged valid
tree may reuse the input Carrier while advancing the observation revision.

A missing Cell, unavailable or incomplete output, invalid Manifest, invalid Git
state, or rejected Candidate result produces no successor Candidate Revision.
The input Revision remains current because no advancement occurred; that is not
rollback, reconstruction from a predecessor, or an unavailable Candidate
state. Provider outcome, Work Product validity, and Candidate advancement are
independent. A timed-out, cancelled, failed, or invalid-submission Attempt may
still produce a successor when its contained output is complete and valid. A
valid Work Product cannot promote invalid physical output.

One builder Attempt need not finish the Candidate. A fresh
`delivery.continue` reconstructs a fresh materialization from the exact current
Revision and Carrier under the same active Boundary. Provider memory, chat
history, a prior Cell, path continuity, an unsubmitted draft, or a cached view
is not continuity. The runtime never redispatches the same Attempt to recover
lost provisional work.

Working and sealed are conditions of this same Candidate. Evaluation selects
one exact Candidate Revision in a Candidate Seal. It does not create another
Candidate or make product bytes canonical. Correction can resume on the same
Candidate; any later Candidate motion makes the prior Seal and affected
Candidate-bound Evidence non-current.

### Conservation and canonical movement

Before Candidate work, evaluation, or Evidence compilation, the runtime
revalidates the active Boundary, current Candidate, immutable Candidate base,
and the exact historical repository snapshot selected by that Boundary. The
Atlas basis fields `atlasStateDigest`, `atlasResolutionDigest`,
`atlasNormalizedModelDigest`, and `atlasResourceBindingsDigest` MUST reproduce
from those historical Git objects. They are not compared with the current
canonical Atlas for active-Delivery currentness.

Applied initial admission derives one active-Delivery branch lease from the
active Work Boundary and Control state. Until Closure, the canonical checkout
MUST remain clean and its HEAD commit and tree MUST exactly equal the admitted
product base. The rule has no Atlas exception. Any canonical commit or
authoritative worktree change prevents continuation, evaluation, revision,
reaffirmation, readmission, and acceptance until exact restoration or no-ship.
Lifecycle MUST NOT merge, rebase, replay, classify, or reconstruct the external
motion automatically, and branch motion by itself is not a Material Condition.

Active operations reproduce their context from the admitted historical Git
objects and do not resolve replacement Atlas meaning from the live checkout.
The clean-checkout and exact-HEAD tests are conservation guards, not context
refresh. Atlas maintenance therefore uses another branch or worktree and may
land on the canonical branch only after Closure and terminal Store disposition
complete. Any Candidate change at or below the authoritative Atlas root remains
independently invalid and cannot be sealed or accepted.

No-ship validates and selects the exact historical Boundary and Candidate
revisions that it abandons without requiring their repository or Atlas basis to
equal the current canonical observation or the checkout to be clean. Because
no-ship integrates no product bytes, it remains available after a branch-lease
violation and releases the lease when Closure and Store disposition complete.

## Public Operations

Foundation rc.10 exposes exactly nine Delivery mutation operations. The runtime
derives all bindings, identities, times, digests, state coordinates, machine
configuration, and effect packages. Public semantic Markdown supplies only
Founder meaning owned by the selected operation.

<!-- markdownlint-disable MD013 -->

| Operation | Semantic input | Agent role | Founder authentication | Concurrency |
| --- | --- | --- | --- | --- |
| `delivery.prepare` | complete fresh Brief | reconnaissance | no | fresh-Delivery preparation |
| `delivery.admit` | none | none | admit or readmit | target-exclusive transaction |
| `delivery.continue` | builder direction | builder | no | Candidate-exclusive |
| `delivery.evaluate` | review direction | reviewer | no | Candidate-exclusive |
| `delivery.revise` | changed-mandate rationale | reconnaissance | no | Delivery-exclusive |
| `delivery.reaffirm` | unchanged-mandate rationale | reconnaissance | no | Delivery-exclusive |
| `delivery.accept` | none | none | accept | target-exclusive transaction |
| `delivery.no-ship` | reason and Candidate disposition | none | no-ship | target-exclusive transaction |
| `delivery.recover` | none | none | reuses retained authority | exact unresolved effect only |

<!-- markdownlint-enable MD013 -->

`delivery.admit` chooses the `admit` Decision variant in
`awaiting-admission` and the `readmit` variant in `awaiting-readmission`.
There is no separate public readmit operation.

`delivery.no-ship` is one operation. It compiles and authenticates one exact
Founder Decision before recording effect intent. There is no separate
selection record, selection operation, authorization operation, Candidate
disposition record, Cell workflow, or Reclamation record.

`delivery.recover` does not start a new activity, allocate a new Investment,
ask for new semantic input, request replacement Founder judgment, or choose a
different effect. It resumes one exact retained obligation and privately
reconciles the reducer-selected Activity's exact Execution Handle when one
exists. Callers never name a Handle, Cell, Backend action, or Reclamation
coordinate.

Every operation is composed through its operation definition. The definition
declares its eligibility requirements, constructs and validates the immutable
semantic plan for a new activity, compiles an Execution Specification when the
operation requires physical execution, validates observations and output, and
compiles its operation-specific Control. The common
[Activity kernel](CONTROL.md#common-activity-kernel) owns durable opening,
checkpoint coordination, reducer-checked recovery, completion, and support
Retirement. `delivery.recover` does not have a parallel workflow: it selects the
one reducer-derived obligation and invokes that activity's retained operation
definition. The reducer alone decides whether any declared operation is legal.

### Semantic operation input

Semantic operation input is bounded UTF-8 Markdown under the interface v10
profile. For every agent operation, the runtime finalizes that exact input as
one fresh `founder-brief` before starting the activity, and the Agent Attempt
binds it. The Brief payload identifies the operation and selected input
profile; the Founder-authored Markdown owns the direction or rationale. It MUST
NOT contain authority secret bytes, an expected Process state, record
identities, repository or Candidate digests, Investment mechanics, provider
executable or model configuration, effect-package identity, transaction
handle, time, or physical path.

Preparation input is one self-contained Frame Brief. Continue and evaluate
input is a fresh direction Brief. Revise and reaffirm input is a fresh exact
resolution-rationale Brief. No-ship input belongs directly to the authenticated
Founder Decision and contains one exact reason and one explicit supported
Candidate disposition. The installed Foundation profile supports `abandon`;
an implementation MUST refuse another disposition. Abandonment ends Candidate
advancement and acceptance; it does not claim immediate Carrier erasure.

### Read models and interface execution

`delivery.inbox`, `delivery.inspect`, `delivery.diff`, and `delivery.watch` are
public read operations, not Delivery mutations. They compile the disposable
runtime read-model layer defined by
[Control](CONTROL.md#runtime-read-model-layer) and never appear in
`eligibleOperations`. A selected Delivery View is the coherent review basis for
any following mutation; the runtime rejects a stale expected read generation
and independently revalidates the Store, reducer, repository,
Candidate, capability, lock, and exact operation inputs before activity start.

Frame is presentation for one fresh `delivery.prepare`; every submission starts
a different Delivery and carries one complete self-contained Brief. Next Pass
is presentation over the intersection of the current reducer result and
`delivery.continue`, `delivery.evaluate`, `delivery.revise`, and
`delivery.reaffirm`. It is not an operation, Process state, retained plan,
provider session, or authority route. Each submitted pass supplies one complete
fresh semantic input and receives a newly allocated Investment and Agent
Attempt. No prior text area, transcript, draft, or recommendation is inherited.

An interface may invoke only `delivery.prepare` and one currently eligible Next
Pass operation through the canonical CLI. It preserves semantic input on a
refusal or incoherent result and clears it only after the complete successor
read generation is established. `delivery.admit`, `delivery.accept`,
`delivery.no-ship`, and `delivery.recover` remain explicit CLI handoffs;
presentation never receives authority material or continues a retained effect.

No public operation allocates, dispatches, observes, cancels, retrieves,
retires, or reclaims a Cell. The CLI and TUI present the Delivery journey. A
container, backend job, Handle, materialization, or Reclamation obligation is
never a user-selected workflow subject.

## Operation Semantics

### Prepare

Preparation creates the fresh Delivery and store, finalizes the Founder Brief,
and performs one read-only reconnaissance activity. The runtime:

1. observes and validates the exact target, repository contract, Knowledge Set,
   Description coverage, source availability, Check registry, and the direct
   Atlas basis fields `atlasStateDigest`, `atlasResolutionDigest`,
   `atlasNormalizedModelDigest`, and `atlasResourceBindingsDigest`;
2. compiles the Orientation Projection;
3. finalizes one reconnaissance Agent Attempt with fresh Investment and
   compiles its exact Execution Specification;
4. allocates and dispatches one Cell, then contains it, retrieves its complete
   Output Carrier, and independently validates the governed semantic workspace;
5. retires the execution and finalizes any valid Work Product plus one truthful
   Execution Receipt;
6. compiles one complete Work Boundary when valid semantics and exact sources
   permit it;
7. runs each selected baseline Check in one fresh Cell; and
8. completes successfully only when the complete baseline set establishes
   proposal readiness under each selected modality.

A successful completion selects the Boundary for admission. An unsuccessful
completion retains every truthful Attempt, optional Work Product, Receipt,
Boundary, and Check Receipt but selects no proposal. The Founder can inspect
that dossier and close the Delivery through no-ship. Retry is a different
fresh Delivery and Investment.

### Admit and readmit

Admission is eligible only for the exact current proposed Work Boundary, after
all activities in that Delivery are terminal and proposal readiness remains
current. The runtime constructs and authenticates one Founder Decision that
selects that revision, every-and-only required modality-valid baseline Check
Receipt for it, the Boundary's exact historical Atlas snapshot, and the exact
complete repository commit and tree. Initial admission also proves that no
other admitted, unclosed Delivery in the installed machine custody holds the
target branch lease. A readmission Decision
additionally binds the exact active predecessor Boundary, resolved Material
Condition, and continuing Candidate Revision. Those role-bearing selections are
part of the signed subject and the retained Decision relationships. Any
canonical or authoritative-worktree movement after Boundary compilation stales
initial admission. Readmission requires the original leased epoch unchanged.

The admission transaction:

1. revalidates the Decision, Boundary, baseline Receipts, Process head,
   historical Boundary Snapshot, exact clean canonical checkout and HEAD,
   Knowledge Set, authority, target lock, and branch-lease exclusivity;
2. persists one exact recoverable effect plan;
3. records effect intent before applying it;
4. truthfully observes `applied`, `not-applied`, or `indeterminate`;
5. after `applied`, either publishes the initial Carrier and retains its
   Candidate Revision or retains the exact readmission rebind to the already
   published current Carrier; and
6. completes only after every required post-effect fact is durable.

An applied initial admission makes the selected revision active. An applied
readmission makes the proposed next revision active, resolves the exact
Material Condition, preserves the same Candidate identity and bytes, preserves
`candidateBaseCommit`, and invalidates proof whose Boundary subject changed.
It then retains the exact next Candidate Revision with byte-identical state,
`revises` the previously current revision, and `governed-by` the newly active
successor Boundary. It does not rebase or replay Candidate work.

Initial admission has one explicit durable interval after the transaction
effect is observed `applied` and before the initialization
`candidate-revision-observed` event. During that interval the admitted Boundary
already governs, so standing is `active`; no Candidate yet exists, so Candidate
condition is `absent`; and the pending Candidate observation exposes only
`delivery.recover`. Candidate initialization completes the admission activity
but does not retroactively establish when the Boundary became active.

Authentication does not claim that the transaction applied. A `not-applied`
observation preserves the pre-intent standing when every subject remains
current. An `indeterminate` observation exposes only exact recovery.

### Continue

Continue is eligible only with one active coherent Boundary, one current
reconstructible Candidate Revision, no unresolved Material Condition, no
current recovery obligation, and a supported builder capability. It creates a
fresh builder Attempt and Investment.

The builder Projection and Attempt are compiled from the active Boundary's
historical admitted repository snapshot, including its Atlas Resolution and
bound Resources, plus the exact current Candidate Revision Carrier. A newer
canonical Atlas is not consulted or substituted and does not affect
eligibility.

The runtime compiles one immutable Execution Specification, allocates and
dispatches one fresh Cell, establishes Containment, and retrieves and
independently validates its bounded output. A valid Candidate output is
published as a Carrier before one optional successor Revision is selected;
invalid or unavailable output creates no successor. Once Work Product and
Candidate output dispositions are final, the runtime retires the execution and
finalizes the Execution Receipt against the input Revision and optional
successor. A valid Work Product can propose progress, readiness, or a Material
Condition. Those remain Agent proposals until the owning runtime rule
establishes a fact.

Local correction is another continue activity. Timeout, context exhaustion,
provider interruption, Cell loss, a failed command, or invalid semantic
Markdown spends that Attempt but does not create a governance phase, invalidate
the input Candidate Revision, or authorize redispatch of that Attempt.

### Evaluate

Evaluation is eligible only for one current reconstructible Candidate under one
active coherent Boundary. It is one Candidate-exclusive activity. The runtime:

1. reopens and validates the exact current Carrier, proves no active writer can
   mutate it, and finalizes one exact Candidate Seal;
2. validates changed paths, artifacts, Knowledge, Description coverage, and
   the sealed Product State against the active Boundary's historical admitted
   snapshot;
3. executes every final Check in one fresh Cell against the exact Seal;
4. compiles a fresh read-only reviewer Projection;
5. operates one independently funded reviewer Attempt in one fresh read-only
   Cell;
6. contains and retires that execution and finalizes its Work Product and
   Execution Receipt when valid; and
7. compiles one Evidence Packet from the exact Seal, Check Receipts, reviewer
   Work Product, reviewer Receipt, and complete ledgers.

The Evidence Packet owns one readiness value:

- `acceptance-ready`;
- `correctable`;
- `revision-required`; or
- `no-ship-recommended`.

The `evidence-packet-finalized` event does not repeat that value. The reducer
loads it from the exact referenced Packet revision. Acceptance-ready permits
Founder acceptance but does not perform it. Correctable returns the same
Candidate to work. Revision-required requires one exact frozen Material
Condition compiled from the material reviewer semantics and exact retained
evaluation joins. No-ship-recommended remains advisory; only the Founder can
select no-ship.

A reviewer receives no Candidate write capability. Any mutation of the sealed
subject invalidates the evaluation coordinate. A failed evaluation preserves
the Candidate and unaffected exact-subject Evidence.

### Revise, reaffirm, and readmit

Revise and reaffirm are eligible only while one exact Material Condition
freezes the active Boundary and current Candidate. Each starts one fresh
reconnaissance Attempt with exact Founder rationale and a fresh reproduction of
the unchanged admitted repository, Atlas, and Knowledge basis. Neither route
reads a newer canonical epoch or permits the Delivery to adopt one.

Revision produces the next Boundary revision with at least one complete
semantic field changed. Reaffirmation produces the next revision with the same
complete mandate semantics and records why the existing mandate remains the
Founder choice. Both preserve the complete predecessor, condition, Candidate
identity, Candidate base, historical Atlas snapshot, and capability
constraints. A different repository or Atlas epoch requires Closure and a
fresh Delivery.

An incomplete resolution activity leaves the Material Condition current and
selects no next revision. A complete resolution requires a fresh complete
modality-valid baseline set and moves standing to `awaiting-readmission`.
Productive work remains blocked until `delivery.admit` authenticates and
applies the `readmit` Decision.

### Accept

Acceptance is eligible only for the exact current active Boundary, Candidate
Revision, Candidate Seal, and acceptance-ready Evidence Packet. The Founder
Decision selects all four exact revisions, the exact admitted parent commit and
tree, and the exact sealed Candidate tree. It authorizes no alternate parent,
Atlas selection, merge, rebase, or composed result.

The recoverable acceptance transaction:

1. revalidates the complete Decision and authority envelope;
2. retains one intent for the exact terminal transaction;
3. reproduces the Seal, Evidence, admitted parent, Carrier manifest and object
   closure, and exact sealed Candidate tree in a transaction-private
   materialization;
4. proves the Candidate has no Atlas-root delta;
5. proves the canonical branch still names the exact admitted parent and the
   authoritative target checkout is completely clean;
6. applies the exact sealed Candidate tree over that exact parent by atomic
   repository compare-and-swap;
7. truthfully observes the effect;
8. verifies every dispatched Delivery execution is contained and retired and
   durably hands any remaining allocation to Reclamation;
9. records Candidate treatment `integrated` without claiming Carrier erasure;
   and
10. finalizes Closure as the last Journal event.

The accepted repository result is the exact sealed Candidate tree. Because the
Candidate is based on the admitted tree and cannot contain an Atlas delta, the
accepted Atlas is exactly the admitted Atlas without terminal resampling or
composition. Closure binds the admitted parent, exact accepted commit and tree,
Candidate digest, Product State digest, Knowledge Set digest, and the generic
canonical result digest.

Any canonical ref movement or authoritative-worktree change before the atomic
effect makes the retained acceptance transaction conclusively `not-applied`.
It creates no alternate result and cannot be repaired by selecting a newer
Atlas, composing trees, rebasing, merging, or retrying against a different
parent. Recovery may only recognize or complete the same exact retained effect.
Exact restoration permits that retained effect to proceed; otherwise the
Founder can close through no-ship.

Delivery Control, Evidence, Founder Decision, transaction facts, and Closure
remain in the Control Record Store off HEAD. Acceptance MUST NOT promote a
Control revision, event, export, SQLite file, or store archive onto the product
branch.

### No-ship

No-ship is the authenticated terminal statement that this Delivery did not
integrate Candidate product bytes. It is not inferred from failure, inactivity,
Agent prose, or stopped Investment.

No-ship is eligible:

- after the sole preparation activity terminates without a proposal;
- while an initial proposal awaits admission;
- while an admitted Candidate is active;
- while a Material Condition pauses the Boundary;
- while a next Boundary revision awaits readmission; or
- while Evidence is ready for a Founder decision.

Before initial admission, the Founder Decision selects the exact proposed Work
Boundary when one exists. After admission, including while a successor awaits
readmission, it selects the active Work Boundary rather than the unadmitted
successor. It also selects the current Candidate Revision and Material
Condition when either exists, one reason, and one supported disposition. A
failed preparation has none of those record subjects and therefore
authenticates the exact Delivery, terminal preparation facts, reason, and
no-Candidate disposition instead.

The recoverable no-ship transaction records intent before its authoritative
effect, verifies that no Candidate product bytes were integrated, permanently
abandons Candidate advancement and acceptance when a Candidate exists, verifies
every dispatched Delivery execution is contained and retired, hands remaining
backend allocations to Reclamation, and finalizes Closure. An
awaiting-admission no-ship Closure relates to the proposed Boundary but has no
Candidate relationship. A failed-preparation Closure has neither Boundary nor
Candidate relationship. An admitted no-ship Closure relates to the active
Boundary and `abandons-candidate` the exact Candidate Revision. Abandonment
does not delete or rewrite historical Revision or Carrier identity.

After a Work Boundary exists, no-ship may use its exact historical repository
and Atlas basis despite ordinary canonical branch or authoritative-worktree
movement. The initialized target identity and Repository Contract must remain
readable so Lifecycle can locate and verify the Delivery; arbitrary destruction
of that identity is outside terminal recovery.

### Recover

Recovery is eligible only when the runtime can derive one exact unresolved
obligation. The standard kinds are:

- `provider` — reconcile the exact Attempt Cell after durable dispatch without
  redispatch, establish Containment, and retrieve bounded output when legal;
- `candidate-observation` — publish and select the exact valid builder
  successor, initial Candidate, or applied-readmission Candidate rebind;
- `transaction` — continue observation or the exact retained transaction
  plan; and
- `finalization` — append deterministic missing revisions or events, retire
  exact support and hand off Reclamation, seal the closed store, or archive it.

Recovery reopens the exact activity, effect digest, Decision, support subject,
and next legal milestone. It can append only the next idempotent fact. Missing
support is not evidence that an effect did not occur. When one continuation
cannot be proved, recovery refuses instead of resampling an identity, time,
semantics, Candidate, outcome, or package.

The recovery registry maps each reducer-derived `kind` and `resumesAt`
coordinate to one owning operation boundary. Neither an operation-support
payload nor an owner-local phase can select recovery. After Closure, the same
reducer supplies only the physical Store-disposition overlay needed to resume
the exact seal or archive; no operation definition may append another event.

## Closed Event Vocabulary

The `journal_events` relation is the sole retained Delivery event source.
Foundation rc.10 supports exactly the following twenty-two kinds. All standard
events are physically appended by the runtime. Record semantic authorship and
authority remain in the exact referenced revision.

The payload column contains exactly the listed fields and no others. Store,
Process, sequence, time, actor, predecessor, and exact optional record subject
belong to the common event envelope and MUST NOT be repeated in the payload.
An empty entry means an empty object.

<!-- markdownlint-disable MD013 -->

| Event kind | Exact record subject | Exact payload fields | Process meaning |
| --- | --- | --- | --- |
| `delivery-created` | none | none | establishes the fresh Delivery event chain |
| `founder-brief-submitted` | `founder-brief` | `activityId` | finalizes fresh semantic input before its agent activity |
| `activity-started` | none | `activityId`, `operation` | starts one eligible funded activity |
| `activity-recovery-recorded` | none | `activityId`, `kind`, `resumesAt`, `exactEffectDigest` | records resumption of its exact obligation |
| `agent-pre-intent-refused` | none | `activityId`, `diagnosticCode`, `refusalFactsDigest` | proves the Agent activity stopped before Attempt finalization or provider intent |
| `agent-attempt-prepared` | `agent-attempt` | `activityId` | finalizes the frozen invocation contract |
| `provider-effect-intended` | exact activity `agent-attempt` | `activityId`, `effectDigest` | makes dispatch intent durable |
| `provider-effect-observed` | exact activity `agent-attempt` | `activityId`, `effectDigest`, `outcome` | records `completed`, `failed`, or `not-started` |
| `agent-work-product-submitted` | `agent-work-product` | `activityId` | finalizes valid submitted Agent semantics |
| `agent-work-product-abandoned` | exact activity `agent-attempt` | `activityId` | closes the workspace with no Work Product |
| `candidate-revision-observed` | `candidate-revision` | `activityId` | selects the exact observed Candidate revision |
| `execution-receipt-recorded` | `execution-receipt` | `activityId` | finalizes terminal invocation facts |
| `work-boundary-finalized` | `work-boundary` | `activityId` | finalizes one complete mandate revision |
| `material-condition-frozen` | `material-condition` | `activityId` | freezes one exact mandate-blocking condition |
| `candidate-sealed` | `candidate-seal` | `activityId` | selects the exact evaluation subject |
| `check-receipt-recorded` | `check-receipt` | `activityId` | finalizes one baseline or final Check fact |
| `evidence-packet-finalized` | `evidence-packet` | `activityId` | finalizes exact evaluation aggregation |
| `founder-decision-authenticated` | `founder-decision` | `activityId` | finalizes exact Founder authority semantics |
| `transaction-effect-intended` | exact activity `founder-decision` | `activityId`, `effectDigest` | makes the transaction plan durable before effect |
| `transaction-effect-observed` | exact activity `founder-decision` | `activityId`, `effectDigest`, `facts`, `factsDigest`, `outcome` | retains typed direct observation facts and records `applied`, `not-applied`, or `indeterminate` |
| `activity-completed` | none | `activityId`, `outcome` | closes a nonterminal activity as `completed`, `failed`, or `abandoned` |
| `closure-recorded` | `closure` | `activityId` | atomically closes the terminal activity and Delivery |

<!-- markdownlint-enable MD013 -->

Every record-finalization event resolves its subject against the exact record
identity, kind, revision, and logical digest in the same store. The reducer
MUST load record-owned decisions, relationships, outcomes, readiness,
disposition, and subject facts from that revision. An event MUST NOT repeat
those facts merely to make reduction convenient.

`provider-effect-intended` and `provider-effect-observed` resolve the exact
Agent Attempt already selected by the activity. Intent durably consumes the
Attempt's one dispatch authority before the private Backend call. It exposes no
Specification, allocation key, Handle, Cell, or backend coordinate and creates
no Execution workflow in Control.
`agent-pre-intent-refused` is legal only at a pre-Attempt recovery boundary and
has no record subject because no Attempt exists. It advances only to
`activity-completed(abandoned)` after the closed prearmed operation and its
private execution support have been retired.
`transaction-effect-intended` and `transaction-effect-observed` resolve the
exact Founder Decision already selected by the activity. The `effectDigest`
identifies the complete recoverable effect plan; it is not a Decision digest,
transaction handle, physical path, or authority secret.

One transaction intent has one matching terminal observation. Recovery MUST NOT
append a replacement intent or authorize a successor effect. Event order and
direct facts must prove whether the exact retained effect applied. A branch
lease violation is not a special retry class and cannot select another parent.

For `transaction-effect-observed`, `facts` is one bounded, closed,
operation-specific direct-observation object from which the runtime classified
`outcome`. `factsDigest` is the exact SHA-256 canonical-value digest that the
runtime derives from those retained facts. Both belong to the immutable event
so replay can validate their closed shape, operation/outcome compatibility,
and digest after current-continuation support has been retired or reclaimed.
They are distinct from `effectDigest` and from the closed outcome enum: the
effect digest binds what was intended, the retained facts and their digest bind
what was directly observed, and `outcome` states the runtime's resulting
applied, not-applied, or indeterminate classification. A transaction handle,
path, diagnostic, prior observation, checkpoint, or caller assertion cannot
substitute for the retained facts.
An Admission `repository-basis-mismatch` disposition MUST repeat the exact
`repositoryBasisDigest` as its `observedFactsDigest`. Every terminal Git object
identity MUST have the length selected by its retained `objectFormat`, including
the attached and canonical coordinates in a detached acceptance observation.
Applied acceptance facts additionally bind the digest of the actual exact
canonical result retained in the checkpoint.

`activity-recovery-recorded` starts no replacement activity. `kind`,
`resumesAt`, and nullable `exactEffectDigest` must equal the obligation derived
at the current event head. Provider and transaction recovery use the retained
effect digest. Candidate-observation and deterministic finalization recovery
use null unless an owning effect still has to be correlated.

`resumesAt` is a closed runtime-dispatch coordinate, not an explanatory string.
The installed recovery registry maps every legal `(kind, resumesAt)` pair to
its exact next event or physical disposition, required retained support, lock
scope, and idempotence rule. Foundation rc.10 supports only these steps:

<!-- markdownlint-disable MD013 -->

| Kind | `resumesAt` | Exact next boundary |
| --- | --- | --- |
| `finalization` | `candidate-sealed` | observe, compile, and retain the exact Candidate Seal selected by the evaluation activity |
| `finalization` | `agent-attempt-prepared` | atomically retain the exact Agent Attempt and provider intent, or retain a pre-intent refusal with no Attempt |
| `finalization` | `provider-effect-intended` | compile and retain dispatch intent for the exact prepared Agent Attempt |
| `provider` | `provider-effect-observed` | observe, contain, and retrieve the same dispatched Attempt Cell without redispatch |
| `finalization` | `work-product-observation` | independently validate retrieved semantic output and submit or abandon the exact governed workspace |
| `candidate-observation` | `candidate-revision-observed` | publish and select the exact initial, valid builder-successor, or readmission-rebind Candidate Revision |
| `finalization` | `execution-receipt-recorded` | retire the exact execution, hand off any Reclamation obligation, and retain the terminal Execution Receipt |
| `finalization` | `work-boundary-finalized` | compile the exact next Work Boundary revision, or retain unsuccessful activity completion when the frozen semantics and exact basis deterministically refuse compilation |
| `finalization` | `baseline-checks` | execute, contain, retire, and retain the next selected baseline Check Receipt or complete after the exact set |
| `finalization` | `evaluation-checks` | execute, contain, retire, and retain the next final Check Receipt, atomically open reviewer Attempt plus intent, or retain a pre-intent refusal |
| `finalization` | `activity-finalization` | retain the next semantics-determined Condition, Evidence, Check, or completion fact |
| `finalization` | `activity-completed` | complete the exact nonterminal activity |
| `finalization` | `founder-decision-authenticated` | authenticate and retain the exact Decision selected by the started transaction activity |
| `finalization` | `transaction-effect-intended` | compile and retain the transaction plan for the exact authenticated Decision |
| `transaction` | `transaction-effect-observed` | another observation of the retained transaction effect |
| `finalization` | `transaction-finalization` | retain the exact Candidate, completion, or Closure fact selected by the determinate transaction |
| `finalization` | `store-seal` | seal the exact Closure-headed Store without another event |
| `finalization` | `store-archive` | archive and verify the exact sealed Store without another event |

<!-- markdownlint-enable MD013 -->

No dispatcher may infer a handler from a novel string, retry a provider or
transaction effect under another identity, or choose among these steps from
caller prose.

## Legal Event Order

### Delivery creation and preparation

Sequence `1` is `delivery-created`. The self-contained Frame Brief then
finalizes before `activity-started` for the preparation `activityId`. Every
later agent activity likewise finalizes exactly one fresh Brief before its
`activity-started` event.

A healthy preparation follows this order:

```text
delivery-created
  -> founder-brief-submitted
  -> activity-started(delivery.prepare)
  -> (agent-attempt-prepared + provider-effect-intended) atomic
  -> provider-effect-observed
  -> agent-work-product-submitted
  -> execution-receipt-recorded
  -> work-boundary-finalized
  -> check-receipt-recorded ...
  -> activity-completed(completed)
```

Provider completion without a valid submission uses
`agent-work-product-abandoned`. Failed and not-started provider observations
also require abandonment, a truthful Receipt, and `activity-completed` with
`failed` or `abandoned`. A Boundary or Check Receipt is appended only when its
exact prerequisites exist. A valid submitted Work Product whose frozen
semantics and exact selected basis deterministically cannot compile a Work
Boundary proceeds from `work-boundary-finalized` directly to unsuccessful
`activity-completed`; repeating that compiler boundary is not recovery.
Unsuccessful preparation never selects a proposal.
Pre-intent refusal instead follows `activity-started -> agent-pre-intent-refused
-> activity-completed(abandoned)` and retains no Attempt, Receipt, or proposal.

### Builder activity

Every continue activity follows:

```text
founder-brief-submitted
  -> activity-started(delivery.continue)
  -> (agent-attempt-prepared + provider-effect-intended) atomic
  -> provider-effect-observed
  -> agent-work-product-submitted | agent-work-product-abandoned
  -> [candidate-revision-observed]
  -> execution-receipt-recorded
  -> [material-condition-frozen]
  -> activity-completed
```

Candidate observation is present only when independently validated output was
published as a durable Carrier and promoted as a successor. It precedes the
Receipt when present. Invalid or unavailable output proceeds directly to a
truthful Receipt with no successor and leaves the input Revision current. A
Material Condition requires a valid Work Product, its Receipt, the
reducer-selected current Candidate Revision, and active Boundary. That Revision
is the successor when one was published and otherwise the Attempt input. The
Condition is never inferred from abandonment or provider outcome alone.

### Evaluation activity

Evaluation follows:

```text
founder-brief-submitted
  -> activity-started(delivery.evaluate)
  -> candidate-sealed
  -> check-receipt-recorded ...
  -> (agent-attempt-prepared + provider-effect-intended) atomic
  -> provider-effect-observed
  -> agent-work-product-submitted | agent-work-product-abandoned
  -> execution-receipt-recorded
  -> [material-condition-frozen]
  -> [evidence-packet-finalized]
  -> activity-completed
```

Final Check Receipts reference the exact Seal. Reviewer execution creates no
Candidate successor. A completed evaluation requires one Evidence Packet. An
operationally failed or abandoned review can complete unsuccessfully without a
Packet while preserving the Seal and every truthful Receipt.
Pre-intent refusal after final Checks preserves the Seal and Checks but retains
no reviewer Attempt or Receipt.

### Boundary resolution activity

Revise and reaffirm use the preparation sequence without `delivery-created`.
Their fresh `founder-brief-submitted` event binds the exact Founder rationale
to the activity, and their Agent Attempt binds that Brief, the active Boundary,
Material Condition, Candidate, and operation.

A successful activity finalizes exactly the next Boundary revision, then every
required fresh baseline Check Receipt, and finally
`activity-completed(completed)`. An unsuccessful activity leaves the active
Boundary and Material Condition current and selects no revision.

### Transaction activity

Admission, acceptance, and no-ship begin:

```text
activity-started
  -> founder-decision-authenticated
  -> transaction-effect-intended
  -> transaction-effect-observed
```

An `indeterminate` observation leaves the same effect unresolved. Exact
recovery can append `activity-recovery-recorded` and another
`transaction-effect-observed` for the same Decision and effect digest. Each
observation retains its own exact direct-observation `facts` and derived
`factsDigest`; a later observation need not reproduce an earlier fact object or
digest. A determinate observation ends that observation chain. `not-applied` is
followed by `activity-completed(failed|abandoned)` after exact support
disposition.

Applied initial admission continues with an `initialization`
`candidate-revision-observed` and then `activity-completed(completed)`. Applied
readmission continues with a `readmission-rebind`
`candidate-revision-observed` and then `activity-completed(completed)`. The
readmission revision has the same Candidate record identity and byte-identical
state and base, revises the previously current revision, and is governed by the
newly active successor Boundary. Direct completion from the applied
readmission effect is invalid.

Applied acceptance and no-ship establish the exact post-effect Candidate
treatment, prove every dispatched execution contained and retired, durably hand
remaining allocations to Reclamation, compile Closure, and append
`closure-recorded`. They MUST NOT append `activity-completed` after Closure.
`closure-recorded` atomically completes the terminal activity and is the final
Journal event. Completed Reclamation is not part of this event order.

For initial admission, observing the effect as `applied` immediately makes the
selected Boundary current. Until the required initialization Candidate is
observed, standing is therefore `active`, Candidate condition remains `absent`,
and recovery resumes at `candidate-revision-observed`. These orthogonal
projections MUST NOT be collapsed into `framing` or a Candidate recovery
condition.

### Finalization and recovery

After every `activity-started`, the reducer immediately derives the next exact
Attempt or Decision boundary as a recovery obligation. Every later durable
milestone replaces that obligation with the next exact missing boundary. A
recovery invocation MAY
append `activity-recovery-recorded` before the missing milestone. It MUST NOT
repeat a completed effect, create a second activity, skip a prerequisite, or
change a retained record revision.

If interruption leaves a terminal effect unresolved, recovery observes or
completes only the same exact retained effect under its Founder Decision,
intent, and `exactEffectDigest`. It cannot choose another parent or result.

Every revision and its registry-owned finalization event append atomically.
`closure-recorded` and Closure are therefore one atomic final append. No event
can follow Closure. This order is required so Closure is the Journal head bound
by the Control Store seal.

## Orthogonal Delivery Reduction

Delivery has no persisted mutable Process-state record. The pure reducer is
the sole legal Process state machine. It validates the complete event chain,
resolves every exact record revision, and
derives four orthogonal dimensions plus current subjects and eligibility.

### Standing

Standing answers which mandate and authority boundary currently governs:

- `framing` — the sole preparation has not produced a proposed Boundary;
- `awaiting-admission` — one exact initial Boundary is proposal-ready;
- `active` — one admitted Boundary governs, including the recover-only interval
  before its initial Candidate observation is durable;
- `boundary-paused` — one Material Condition blocks productive work;
- `awaiting-readmission` — one next Boundary revision awaits readmission;
- `decision-ready` — one exact acceptance-ready Evidence Packet is current;
  and
- `closed` — Closure is the Journal head.

Standing does not encode a running provider, transaction, Candidate display
condition, or store-archive status.

### Activities

Each activity has exact identity, operation, family `agent` or `transaction`,
and one derived stage:

- `started`;
- `prepared`;
- `effect-intended`;
- `effect-observed`;
- `submitted`;
- `finalizing`; or
- `completed`.

One Delivery has exactly one preparation activity. After preparation, at most
one unresolved activity exists in that Delivery. Cross-Delivery preparation
can be parallel; activity arrays MUST NOT be used to merge their stores.

Closure atomically completes its terminal transaction activity even though no
later `activity-completed` event exists.

These stages are projections of the closed Journal vocabulary. They are not a
persisted workflow-stage DSL, and an operation plan, checkpoint, adapter, or
dispatcher cannot add a stage or use one of its own to authorize progress.

### Candidate condition

Candidate condition is derived independently from standing:

- `absent` — no Candidate Revision exists;
- `ready-for-work` — a current reconstructible working revision has no blocking
  activity or condition;
- `in-progress` — an unresolved Candidate-touching activity owns the exact
  Candidate and is still at its durable `started` or `prepared` stage before
  Candidate sealing or effect intent;
- `needs-correction` — current Evidence identifies correction inside the
  admitted mandate;
- `paused-for-boundary` — a Material Condition freezes productive work;
- `sealed-under-evaluation` — the current Candidate Revision is selected by a
  current Seal but is not acceptance-ready;
- `ready-for-decision` — current Evidence is acceptance-ready;
- `terminal-recovery` — the Candidate exists and an unresolved activity has
  advanced beyond its preparatory stage, so a Candidate seal, effect,
  observation, subject retention, or post-effect finalization obligation must
  resume;
- `accepted` — Closure records integration of the exact sealed revision; or
- `abandoned` — Closure records no-ship treatment of an existing Candidate
  without integration.

Candidate subject existence has precedence over every activity or physical
recovery overlay: when no current Candidate exists, Candidate condition is
`absent`. A preparation recovery and the applied-initial-admission interval
therefore leave Candidate condition `absent`; recovery remains visible in its
own dimension. Invalid or unavailable builder output creates no Candidate
observation and cannot replace the current `ready-for-work` Revision. No-ship
before a Candidate exists also leaves Candidate condition `absent`; the
separate Delivery standing and Closure disposition report that the Process is
closed.

The existence of a recovery obligation alone does not imply
`terminal-recovery`. Every unresolved Activity head is recoverable. When a
Candidate-touching Activity remains at `started` or `prepared`, its exact
pre-effect or pre-seal recovery coordinate preserves `in-progress`, subject to
the stronger current Material Condition, acceptance-ready Evidence, and
sealed-evaluation projections above. Once that Activity advances beyond those
preparatory stages while still unresolved, its exact recovery projects
`terminal-recovery`. This distinction keeps recoverability orthogonal to the
Candidate's semantic work condition.

After Closure, Candidate condition remains the terminal Candidate disposition:
`accepted`, `abandoned`, or `absent`. A missing Store seal or archive does not
rewrite that value to `terminal-recovery`; it is an independent physical
recovery overlay.

### Recovery

Recovery is a nullable exact obligation per unresolved activity, plus an
optional post-Closure store-disposition obligation. It contains `kind`,
`resumesAt`, and `exactEffectDigest` when one effect is current.

Any unresolved recovery obligation suppresses every operation except
`delivery.recover`. After Closure, missing store seal or archive verification
creates a `finalization` recovery overlay even though standing is `closed` and
Closure remains the Journal head. Store sealing and archiving append no later
event. That overlay changes neither the terminal Candidate condition nor any
current Process subject.

### Current subjects

The reduction carries exact nullable references to:

- proposed Work Boundary;
- active Work Boundary;
- current Candidate Revision;
- current Material Condition;
- current Candidate Seal;
- current Evidence Packet; and
- Closure.

Currentness comes from event order and record relationships, not the latest
physical revision. A proposed successor does not replace the active Boundary.
A changed Candidate clears current Seal and Evidence joins. Readmission clears
the resolved Material Condition and invalidates Boundary-dependent proof.

### Eligibility

After currentness, repository, Candidate, authority, lock, and recovery checks,
the complete operation set is:

<!-- markdownlint-disable MD013 -->

| Derived condition | Complete eligible operation set |
| --- | --- |
| fresh Delivery before preparation starts | `delivery.prepare` |
| preparation recovery | `delivery.recover` |
| framing after unsuccessful terminal preparation | `delivery.no-ship` |
| awaiting-admission | `delivery.admit`, `delivery.no-ship` |
| active, initial Candidate observation pending | `delivery.recover` |
| active, Candidate reconstructible, no unresolved activity | `delivery.continue`, `delivery.evaluate`, `delivery.no-ship` |
| boundary-paused | `delivery.revise`, `delivery.reaffirm`, `delivery.no-ship` |
| awaiting-readmission | `delivery.admit`, `delivery.no-ship` |
| decision-ready | `delivery.accept`, `delivery.no-ship` |
| any unresolved activity recovery | `delivery.recover` |
| closed but store seal or archive incomplete | `delivery.recover` |
| closed and archive verified | none |

<!-- markdownlint-enable MD013 -->

Every unresolved live activity has one exact recovery obligation at every
durable event head. The current operator can satisfy that obligation directly;
after interruption, `delivery.recover` resumes it without creating a second
activity. A stale display, cached Attempt View, operation name, or
caller-supplied state cannot make another operation eligible. Invocation always
replays and revalidates the exact live subjects.

## Local Correction and Material Conditions

A local defect is correctable without changing selected product meaning,
exclusions, effects, risks, capability, Knowledge authority, or the assessment
basis. Examples include an implementation bug, missing admitted artifact,
failed final Check, incomplete Description update, or reviewer rejection that
the existing mandate already authorizes.

Correction uses `delivery.continue` on the same Candidate and active Boundary.
It invalidates only proof whose exact subject changed.

A Material Condition is a fact that prevents honest continuation without
changing or explicitly reaffirming Founder judgment. Standard classes include:

- meaning ambiguity or mandate falsifier;
- scope, effect, or risk change;
- architecture or Assurance conflict;
- missing authority or required source;
- required capability unavailable;
- Projection closure exceeded; and
- no honest route.

Canonical branch or authoritative-worktree movement during the lease is an
operational lease violation, not a Material Condition. It cannot be converted
into a changed mandate inside the same Delivery.

The runtime finalizes one `material-condition` revision only from exact retained
source facts and the active reducer coordinate. An Agent proposal remains
agent-proposed semantics; the runtime-owned Condition establishes the Process
freeze. While it is current, productive continuation is ineligible. Revision,
reaffirmation plus readmission, or no-ship resolves it.

## Transactions and Exact Recovery

An authority-bearing operation separates three subjects:

1. the Founder Decision owns authenticated judgment;
2. the transaction effect plan owns exact recoverable mechanics; and
3. event observations own whether the effect was applied.

The Decision is not mutated with future outcome. An event does not repeat the
Decision. Runtime support can retain the complete plan, authority envelope,
compare-and-swap inputs, private Execution Handles, allocation keys, and
Reclamation coordinates only outside semantic Control fields. The public
`effectDigest` binds that exact support without exposing it.

Intent is durable before every transaction's first authority-bearing external
effect. An observation is:

- `applied` when the exact intended authoritative effect is directly verified;
- `not-applied` when direct observation proves it did not move; or
- `indeterminate` when neither conclusion is safe.

Indeterminate observation is not failure and does not authorize another
effect. Recovery continues observation or execution of the exact
already-authorized plan.
It MUST NOT request a new Decision, repeat product judgment, prepare a
different semantic result, select another Candidate, or treat missing support
as proof of absence. Acceptance cannot derive a different parent, tree, or
concrete commit from canonical movement.

Admission and readmission change Process authority but do not promote Control
onto HEAD. Acceptance alone makes the exact sealed Candidate tree canonical
over the exact admitted parent. No-ship leaves canonical product bytes
unchanged while establishing an authenticated terminal Process disposition.

## Closure, Seal, and Archive

Closure is one sufficient immutable terminal Control revision. Its exact typed
payload and relationships establish:

- `accepted` or `no-ship` disposition;
- authenticated Founder Decision and applied transaction facts;
- selected Work Boundary when one exists;
- exact accepted or abandoned Candidate Revision when one exists;
- Candidate Seal and Evidence Packet for acceptance;
- Candidate treatment: `integrated` for acceptance, `abandoned` for
  no-ship after Candidate creation, or `not-created` for no-ship before it;
- for acceptance, the admitted parent and exact accepted canonical result
  identity, or verified non-integration for no-ship;
- the exact terminal execution-subject set, Containment, Runtime Retirement,
  and immutable Reclamation-handoff and obligation-set digests at Closure;
- runtime and rule coordinates; and
- complete readable terminal rationale.

An accepted Closure requires active Boundary, Candidate, Seal, and Evidence.
An admitted no-ship Closure requires active Boundary and Candidate. A no-ship
Closure before initial admission references the proposed Boundary when one
exists and has no Candidate relation. When a successor awaits readmission,
Closure references the still-active Boundary, not that successor. A
failed-preparation no-ship Closure has neither Boundary nor Candidate relation.
Absence is legal only when the event fold proves that subject never existed; it
cannot erase or omit a prior subject.

Closure replaces no record with another carrier. There is no Control Index,
terminal document set, no-ship selection, Candidate-disposition observation,
Reclamation observation, transaction record family, or canonical Control copy on
HEAD. The exact facts live in the Decision, events, Closure, and referenced
immutable revisions.

`closure-recorded` MUST be the final Journal event and exact Closure subject.
The runtime then:

1. verifies the entire store, every revision, relationship, event, and adjacent
   file;
2. proves every governed authoring workspace unreachable for productive use,
   every selected execution retired, every remaining allocation durably handed
   to Reclamation, and `drafts/` empty;
3. creates the immutable logical-inventory store seal bound to Closure and the
   Journal head;
4. closes writable SQLite connections and verifies no hot journal, WAL, or
   shared-memory file exists;
5. writes the retrieval-byte archive manifest;
6. atomically moves the complete store off HEAD to its exact archive root; and
7. reopens the archive read-only and verifies retrieval bytes, logical
   inventory, Closure, seal, and manifest.

An interruption after Closure never appends another event. Exact
`delivery.recover` resumes only the missing seal or archive boundary. Terminal
status remains derived from Closure; terminal operational completeness also
reports whether the sealed archive is verified.

The archive is the complete retained Delivery Control subject. Product
Knowledge and accepted product bytes remain in their repository owners.
Candidate Revision Carrier manifests are adjacent referenced files in the
archive; their content-addressed Git object closures remain in the Carrier
Store while the archive is retained. Cell materializations, provider packages,
drafts, credentials, private Handles, Reclamation coordinates, and caches are
not archive members.

## Concurrency

Preparation concurrency is per Delivery Store. Several distinct fresh
Deliveries can run reconnaissance in parallel because they are read-only with
respect to Candidate and canonical Product State. Each still owns one exact
activity and event chain. Preparation holds no branch lease.

Candidate successor publication, Candidate sealing, and proof against one
Candidate are Candidate-exclusive. Provisional writes occur only inside that
activity's Cell and receive no independent concurrency authority. Boundary
resolution is Delivery-exclusive. Admission,
readmission, acceptance, and no-ship use the target's canonical-transaction
lock. Recovery acquires the same scope as the exact effect it resumes.

All canonical repository mutations sharing one physical Git common directory
use the same compare-and-swap and operation-lock domain, including linked
worktrees. A busy refusal means no requested activity started. Read-only status
can run concurrently only when it presents one coherent store and repository
coordinate.

Two Deliveries can propose overlapping results. Within one installed Lifecycle
machine custody, at most one admitted, unclosed Delivery may hold the lease for
one target and canonical branch. Initial admission establishes that operating
lease under the target lock. Readmission retains it; accept or no-ship releases
it only after Closure and terminal Store disposition. This is a Lifecycle
coordination rule, not a physical Git lock against another installation or
manual actor; every such external movement is detected by the exact active-
operation guard. Acceptance is the lease holder's sole authorized canonical
branch move. Atlas maintenance and every other canonical change must wait for
Closure and terminal Store disposition before landing on that branch.

## Failure Semantics

Delivery fails closed on:

- unsupported coordinate, operation, event, record kind, or relationship;
- event gap, fork, digest mismatch, illegal subject, payload field, or order;
- unavailable or mismatched exact record revision;
- unavailable historical repository subject, canonical branch mismatch,
  authoritative-worktree dirt, or stale Boundary, Candidate, Seal, Evidence,
  Decision, or transaction subject;
- missing or corrupt Carrier, unvalidated Candidate promotion, rebase,
  cross-Delivery reuse, or Control promotion;
- invalid Founder authentication or effect-plan substitution;
- direct SQL modification, missing exact support, or ambiguous recovery;
- incomplete Containment or Retirement, substituted Handle or allocation,
  missing Reclamation handoff, or untracked executable capability; and
- Closure-head, store-seal, archive-manifest, or retrieval-byte mismatch.

Failure is local to its owner. Provider failure does not delete the Candidate.
Invalid Agent Markdown does not become a Work Product. A Check failure does not
rewrite its proposition. An Evidence failure does not revoke Founder authority
already used for another exact subject. A failed transaction does not claim
canonical motion.

The runtime MUST NOT repair a failure by choosing the newest row, longest event
chain, strongest-looking proposal, cached state, similar digest, provider
message, exported Markdown, or direct database edit.

## Diagnostics

Delivery reserves these diagnostic families:

- `lifecycle.delivery.creation.*`;
- `lifecycle.delivery.operation.*`;
- `lifecycle.delivery.event.*`;
- `lifecycle.delivery.reduction.*`;
- `lifecycle.delivery.preparation.*`;
- `lifecycle.delivery.admission.*`;
- `lifecycle.delivery.boundary.*`;
- `lifecycle.delivery.candidate.*`;
- `lifecycle.delivery.condition.*`;
- `lifecycle.delivery.evaluation.*`;
- `lifecycle.delivery.authority.*`;
- `lifecycle.delivery.transaction.*`;
- `lifecycle.delivery.closure.*`; and
- `lifecycle.delivery.archive.*`.

Diagnostics identify a stable code, stage, and bounded observed facts. They
MUST NOT expose semantic body text, authority secret bytes, provider
credentials, physical roots, transaction handles, or adjacent-file contents.

## Non-Goals

Delivery does not:

- introduce another development object beside Candidate;
- split Working and Sealed Candidate into separate identities;
- retain a mutable Process state, currentness row, or Attempt View;
- retain Agent Attempts as append-only development logs;
- record ordinary edits, tests, commands, provider events, or reasoning;
- collapse Attempt, Work Product, Receipt, Candidate Revision, Evidence, or
  Founder Decision into one carrier;
- make Agent prose authoritative for repository, Candidate, Check, or Process
  facts;
- make an Agent construct headers, fixed bindings, relationships, ordering,
  digests, events, envelopes, or transport values;
- place Delivery Control, SQLite, exports, or archives on HEAD;
- infer authority from eligibility, interface state, or agent recommendation;
  or
- provide predecessor support, migration, compatibility carriers, or a second
  Process route.
