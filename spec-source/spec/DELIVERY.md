# Lifecycle Delivery

> Status: Draft

## Purpose

This document defines Delivery, the sole Lifecycle Process. One Delivery
governs one bounded product result from one fresh Director Brief through an
accepted canonical result or an authenticated no-ship disposition.

Delivery owns operation eligibility, the sole legal event reduction, Work
Boundary standing, Candidate continuity, Material Condition handling,
Director-authorized transactions, exact recovery, Closure, and terminal store
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

## Foundation rc.17 Cut

Delivery rc.17 is selected only with this coordinated fresh Foundation set:

<!-- markdownlint-disable MD013 -->

| Coordinate | Selected value |
| --- | --- |
| Qualification revision | `lifecycle.foundation.1.0.0-rc.17` |
| Repository contract | `lifecycle.repository.v22` |
| Runtime protocol | `lifecycle.runtime.foundation.v17` |
| Interface protocol | `lifecycle.interface.foundation.v17` |
| Provider adapter | `lifecycle.provider-adapter.v7` |
| Control Store | `lifecycle.control-record-store.v2` |

<!-- markdownlint-enable MD013 -->

An rc.17 runtime applies the coordinated unsupported-carrier refusal owned by
[Control](CONTROL.md#foundation-rc17-hard-cut) and
[Evolution](EVOLUTION.md#fresh-only-hard-cut).
Export similarity and matching display text do not create compatibility.

No unsupported coordinate has compatibility, migration, recovery, or
publication standing.

The package version remains `1.0.0`. No package label substitutes for the exact
coordinates above.

## Process Invariant

Delivery preserves this invariant:

> Productive work can become canonical only when it remains inside one
> Director-admitted Work Boundary and the exact sealed result satisfies every
> required obligation under independent Evidence.

The integrated route is:

```text
fresh Director Brief
  -> reconnaissance Attempt and Agent Work Product
  -> runtime-compiled Work Boundary Revision
  -> exact modality-valid baseline Check Receipts
  -> Director-authenticated admission transaction
  -> applied observation makes the same Boundary active
  -> exact initialization observation creates one Candidate
  -> independently funded builder Attempts on that Candidate
  -> continue, correct, or resolve a Material Condition
  -> integration against one exact canonical parent
  -> resolve changed governing context and readmit when required
  -> exact integrated Candidate Seal, final Checks, and independent review
  -> Evidence Packet
  -> Director-authenticated acceptance or no-ship transaction
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
subject, Director authority, canonical product state, or exact recovery
coordinate changes.

## Productive Completeness

Ordinary legitimate work MUST remain expressible and completable through the
same governed operations that enforce the shipping invariant. This requires
legal routes, not guaranteed provider success or acceptance of an unsupported
result. Within the selected capability and processing bounds, a conforming
runtime MUST support:

- an authorized change to existing Product Knowledge, with admitted and
  Candidate revisions independently identified for comparison and review;
- complete independently valid Candidate output from an unsuccessful Attempt,
  retained under the [Candidate successor rules](ATTEMPTS.md#candidate-successor-promotion);
- local correction under the same governing mandate through a fresh funded
  continuation, without requiring readmission merely because an implementation
  route, command, or semantic submission failed;
- exact recovery when admission, acceptance, or no-ship is interrupted between
  intent, application, observation, and finalization; and
- authenticated no-ship for eligible unsuccessful work without requiring an
  Evidence Packet or inventing a missing Boundary or Candidate.

These obligations do not waive currentness, confinement, independent review,
Director authentication, or output integrity. The
[Director–Worker pair](AUTHORITY.md#operating-roles) permits either actor to be
human or agent; an already authorized course does not acquire a new human
approval step. A refusal preserves the strongest
truthful state and identifies the failed precondition. It cannot replace a
required legal route with a blanket prohibition on changed Knowledge, failed
Attempts, correction, or interrupted effects. [Conformance](CONFORMANCE.md#required-operated-scenarios)
owns the operated scenario requirements.

## Operation Contracts

Each existing operation definition MUST establish five parts of its contract
before the corresponding effect or finalization:

<!-- markdownlint-disable MD013 -->

| Part | Required relationship |
| --- | --- |
| Exact subject and preconditions | Target, Delivery, reducer coordinate, and every applicable Boundary, Candidate, Seal, or frozen Condition are identified and eligible. |
| Resolved selections | Permitted policies, profiles, capability, and Investment are bound to the lifetime they govern. |
| Permitted effects | Each external effect has an exact scope, subject, and authorizing owner. |
| Observation and finalization | Each retained fact follows from the observation or authenticated decision defined by its owner; successor selection follows durable Carrier publication. |
| Recovery obligation | Interruption retains the same subject, resolved choices, plan, and uncompleted obligations. |

<!-- markdownlint-enable MD013 -->

A concluded unmet requirement, a required mandate response, and an unresolved
physical effect have different continuation contracts. Each phase MUST expose
its truthful settlement or retained obligation. Recovery cannot repeatedly
reselect the same impossible context merely because no effect began, and
completion cannot erase an effect whose outcome is still unknown.

Preparation binds its complete repository Snapshot and exact context with its
first Activity before allocation. Installed prerequisites are checked before
publishing a Store. If first opening fails, only a provably empty, unexposed
staging Store may be removed. Once an Activity or support obligation is retained,
its named Store remains recoverable. Recovery reopens that retained basis even
after canonical movement or live checkout edits; preparation has no canonical
effect that could justify replacing its basis with the live tree.

This contract uses the existing operation owners and [common Activity
kernel](CONTROL.md#common-activity-kernel). It adds no record family, policy
language, or workflow engine. The reducer owns legal state and eligibility;
operation definitions own semantic plans and result compilation; the Activity
kernel owns durable coordination; the Backend executes the exact Specification.
Evidence interpretation belongs to the
[Evidence verifier](EVIDENCE.md#evidence-verifier). Operation composition
collects and retains the exact inputs and verified result without redefining
acceptance conditions.

The operation definition owns the semantic effect plan and requests its
application through the existing execution, authority, or transaction owner.
It MUST NOT receive that owner's general consequential capability merely to
compose the operation. The effect owner verifies the exact request under its
own contract; caller selection or a previously validated value cannot authorize
a substituted effect. [Security](SECURITY.md#consequential-capability-ownership)
defines this capability boundary and its distinction from physical isolation.

Selections MUST bind at their actual lifetime. Product meaning, required
Evidence, and authority-relevant limits belong to the admitted Work Boundary or
its governing Repository Contract. Model, reasoning allocation, authoring
profile, and Investment bind when the Attempt is constructed, subject to those
limits. Backend, Image, runner, and Input Set bind in the exact execution plan
before effects. Presentation preferences do not enter semantic identity unless
their owning contract makes them semantically consequential.

A proposed Work Boundary selects its explicit permitted Execution Projection
profile from the governing repository's exact registered profiles. A default
or prior selection is proposal guidance, not a substitute for that choice.
Changing only permitted context capacity does not change product mandate
semantics; the exact successor Boundary still requires authenticated
readmission. Capability changes retain their separate authority meaning.

A future operation may select a changed permitted default. An open operation
MUST recover its retained selections and MUST NOT consult changed defaults to
reinterpret its plan, waive a requirement, or substitute a subject. One fixed
implementation at each selection boundary is sufficient.

A retained [Work Delegation](ATTEMPT_VIEW.md#work-delegation) selects resources
for a bounded set of future productive operations under one exact admission.
It does not create another Process, Activity stage, or eligibility rule. A
Runtime caller freshly observes settled work, selects a useful existing
operation, and requests an atomic reservation through that operation's normal
opening. The reducer validates the exact grant, subjects, decision basis and
lifetime charges. The execution owner independently binds each actual Agent or
Check to its reserved resources. Eligibility alone is not a reason to fund work.

Permission can expire, stop, or cease to match the governing admission while
an opened operation still needs to finish. Those changes prevent a fresh
opening; they MUST NOT reinterpret or abandon the already retained obligation.
The Store's [stop custody](CONTROL.md#work-delegation-stop-custody) permits an
independent bounded request without a second Journal writer. Only the existing
Delivery writer folds that request after the opened operation settles.

Structural validation establishes legal shape and internal relationships.
Subject binding establishes that valid values belong to this exact operation.
Currentness checking reobserves mutable conditions at the actual effect
boundary under the owning lock and observation rules. Reusing a structurally
validated internal value MUST NOT bypass retained-byte verification, exact
subject binding, or effect-time currentness.

## One Fresh Delivery

One `delivery.prepare` request creates one fresh Delivery identity and one new
Control Record Store. It finalizes one complete self-contained Director Brief
and starts exactly one preparation activity. That Delivery never inherits a
Brief, Work Boundary, Agent summary, TUI transcript, provider conversation, or
hidden Process state from another Delivery.

A later fresh reconnaissance request creates another Delivery and Store. It
does not replace an existing proposal or append another preparation Activity.
Several Deliveries MAY prepare and continue concurrently for one target. Each
owns an independent private Git repository and branch, separate Store, Journal,
Candidate lineage, Activities, locks, and authority subjects. No Delivery holds
a long-lived canonical branch lease. Initial admission authenticates the exact retained proposal Snapshot and
target identity even after live canonical movement; it has no canonical product
effect. An active Delivery instead uses explicit integration
and, when required, readmission without replacing its identity.

Every operation after creation names one exact existing Delivery through the
runtime protocol. A target locator alone MUST NOT select whichever Delivery is
newest. The runtime exposes the target-scoped Delivery Inbox defined by
[Control](CONTROL.md#delivery-inbox). It cannot merge or transfer Process state,
and selecting one row names that exact Delivery rather than ambient recency.

An unsuccessful preparation remains an open Delivery until the Director either
invokes its eligible no-ship operation or leaves it unfinished. The runtime
MUST NOT manufacture Closure, delete the store, or silently reuse its Brief in
another Delivery.

## Work Boundary

The Work Boundary is the complete immutable envelope against which a Delivery
is governed and assessed. Its mandate states the intended result and
obligations. Its basis and selections establish which exact context and limits
support that mandate. Revision `1` is compiled from the Delivery's Director
Brief, reconnaissance Work Product, exact repository and Knowledge observations,
and runtime rules. A later revision is compiled only to resolve one exact
Material Condition.

This distinction matters during resolution. A larger permitted Projection
profile can make the same mandate executable; a changed capability or product
outcome changes the governing choice. Both require an exact successor Boundary
and authenticated readmission, but they are not the same comparison. During
integration, the Boundary's governing Snapshot can also remain historical while
a different exact canonical parent becomes the Candidate's application base.

The Work Boundary record owns its complete typed facts and readable semantics.
It is not split into Preparation, Proposal, and admitted copies. Proposed,
admission-ready, active, superseded, and unselected are reducer-derived
standings over the same immutable revision.

### Identity and revision

An initial Work Boundary:

- has revision `1` of one stable Boundary identity;
- relates to exactly one Director Brief and one reconnaissance Work Product;
- has no predecessor or Material Condition; and
- is finalized before its baseline Checks run.

A revised or reaffirmed Work Boundary:

- uses the same Boundary identity and exactly the next revision;
- relates to the exact active predecessor and Material Condition;
- binds the current Candidate without changing its identity, bytes, or per-revision application base;
- reproduces the governing snapshot, or the exact integration parent selected
  by a runtime context-change or exact reviewer applicability Condition;
- records the exact Director resolution rationale supplied to the operation;
  and
- receives a fresh complete baseline Check set.

Historical revisions remain immutable and addressable. A successor becomes
active only when its exact authenticated readmission is observed applied.
For either integration-parent resolution route defined below, the successor binds the complete
retained parent Snapshot and its governing Knowledge, Atlas, and Registry.
Readmission preserves the frozen integrated Candidate bytes and application
base. It does not authorize a silent merge or choose a newer live parent.

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
- the exact Discipline Registry digest, zero or more selected Work Type ids,
  and the exact selected Discipline subset of those Knowledge identities;
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
an authenticated Director Decision. The direction does not become a Knowledge
or external-source root. No other boundary-local fragment is an Obligation
source.

An explicitly authored Obligation MAY cite selected Discipline Knowledge in
`sourceIds` as informational provenance. Its required force comes from the
explicit Work Boundary meaning activated by Director admission, not from the
Discipline publisher or the cited practice. The compiler MUST NOT infer an
Obligation, required Check, proposition, or required Evidence from the guidance
body, Work Type membership, tags, or selection alone.

Discipline selection is advisory. A Work Type validates against the exact
Registry but does not auto-select its grouped records. The Boundary's
`disciplines.records` MUST equal the exact Discipline subset of its selected
Knowledge, and `disciplines.registryDigest` MUST identify the bound Registry.
Selected guidance reaches builder and reviewer without generating an obligation,
Check, acceptance proposition, or Evidence requirement. Any requirement that
must gate Delivery belongs in an existing authoritative carrier.

The complete Discipline root and Registry are outside Delivery write scope.
Operations consume their exact selected historical bytes. Separate maintenance
may advance the canonical adopted corpus or router while Deliveries continue.
An explicit integration assessment detects changes to governing selections;
replacing those selections inside the Delivery requires a complete successor
Boundary and authenticated readmission. Recovery always reopens retained bytes.

### Baseline Checks and proposal readiness

The runtime finalizes the Work Boundary before obtaining baseline Receipts so
every Receipt can reference that exact revision. The Boundary MUST NOT point
forward to future Receipts. Executable baseline Checks run in fresh Cells; a
baseline postcondition records its authorized `not-run` without allocating a
Cell.

Each required baseline selection produces one truthful `check-receipt` revision.
Proposal readiness is derived only when:

- the complete required Check and Binding set has one exact Receipt per
  required baseline selection;
- every Receipt references the same Work Boundary revision;
- every baseline disposition is legal for its selected temporal modality and
  every admission-gating baseline obligation is satisfied under the selected
  rc.17 profile;
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
proposed admission subject. Director authentication selects those same bytes;
admission does not copy or recompile them.

## Candidate Continuity

The Candidate is Delivery's sole reversible development product-state object.
It is not a Control record, physical worktree, Execution Cell, or second
Process. Continuity consists of the reducer-selected Candidate Revision and its
exact Candidate Revision Carrier.

Initial admission follows this exact order:

```text
Director Decision authenticated
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

The Candidate identity never changes during the Delivery. Each revision's
`candidateBaseCommit` is immutable; only an explicit integration successor may
select a new application base. A builder Attempt receives the current Revision
and Carrier in an immutable Execution Input Set. Its provisional Cell writes
do not mutate the Candidate or authorize a base change.

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

Before Candidate work, evaluation, or Evidence compilation, the runtime MUST
reproduce the active Boundary's exact governing snapshot and the current
Candidate's exact application base from retained Git objects. The four Atlas
basis digests remain bound to their own Snapshot. A newer canonical epoch is
not an implicit context input and does not block ordinary continuation.

Candidate contribution is the delta from its application parent to its current
tree. After integration from source C(base B) against canonical P produces
I(base P), validate scope, changed artifacts, Knowledge, and protected roots over
P→I. Upstream B→P changes MUST NOT be classified as Delivery-authored changes.
Atlas and Discipline bytes in I MUST equal P. The active Boundary can still
bind B when its governing selections remain applicable; that does not make B
the physical comparison parent for I.

No-ship validates the exact historical revisions it abandons without requiring
their bases to equal live canonical state. No-ship promotes no product bytes.

### Explicit integration

`delivery.integrate` is a runtime operation over the exact current Candidate,
active Boundary, and one newly observed complete canonical parent Snapshot.
It accepts no caller-supplied parent, merge strategy, semantic Markdown, or
Director credential. Before construction it retains exact source C/base B,
parent P, and fixed merge-rule selections in runtime custody for recovery.
Its Integration Assessment binds C and W by relationships and P in its payload.

The selected rule `lifecycle.integration.three-way.v2` constructs one exact
three-way result from B/C/P. Repository-authored merge drivers, hooks, and
configuration MUST NOT select executable integration behavior. Protected roots
are preserved from P. The owner validates the exact result and complete Carrier
before selecting an `integration-successor` under the same Candidate identity.
That revision `revises` C and `integrated-from` references the constructed
Assessment. Result state and Carrier facts belong only to the successor.

A conflicted or invalid Assessment retains exact bounded facts and leaves C
current. Completing an assessment does not assert Candidate advancement.
Conflict alone is not a Material Condition: ordinary correction under W and a
new explicit integration remain available. Recovery reopens the retained inputs
and rule; it MUST NOT sample a replacement parent or silently retry a merge.

The Assessment compares the exact governing contract, selected Atlas semantic
closure, selected Discipline adoption, Knowledge closure, and required-source
selections from W
with their counterparts at P. Compare content under the fixed domain-separated
rule; a different epoch wrapper alone is not changed context. An unchanged
comparison permits W to continue governing I, subject to independent review.
Changed governing context yields `requires-readmission` and one runtime-owned
`integration-context-change` Material Condition freezing I. The Assessment,
successor, Condition when required, and completion are one guarded finalization
plan; an interrupted prefix permits only exact recovery, never productive use
of I before its required freeze is durable.

A context-change Condition is sourced from the exact Assessment, not a fake
Agent Work Product or Execution Receipt. Revise/reaffirm uses its frozen P
Snapshot, produces W'(P), obtains fresh required baseline Receipts, and readmits
byte-identical I. The ordinary complete mandate comparison selects revise or
reaffirm; repository observation movement alone is not a changed requirement.

Integration is Candidate-exclusive and uses an `integration` Activity. It is
eligible for an unpaused active Candidate, including after failed evaluation,
decision-ready Evidence, or conclusively not-applied acceptance. A successor
clears the prior Seal and affected Evidence. Acceptance requires explicit
integration provenance, including when P equals the preceding base.

## Public Operations

Foundation rc.17 exposes exactly ten Delivery mutation operations. The runtime
derives all bindings, identities, times, digests, state coordinates, machine
configuration, and effect packages. Public semantic Markdown supplies only
Director meaning owned by the selected operation.

<!-- markdownlint-disable MD013 -->

| Operation | Semantic input | Worker assignment | Director authentication | Concurrency |
| --- | --- | --- | --- | --- |
| `delivery.prepare` | complete fresh Brief | reconnaissance | no | fresh-Delivery preparation |
| `delivery.admit` | none | none | admit or readmit | Delivery-exclusive transaction |
| `delivery.continue` | builder direction | builder | no | Candidate-exclusive |
| `delivery.integrate` | none; exact current coordinate only | none | no | Candidate-exclusive; short parent observation |
| `delivery.evaluate` | review direction | reviewer | no | Candidate-exclusive |
| `delivery.revise` | changed-mandate rationale | reconnaissance | no | Delivery-exclusive |
| `delivery.reaffirm` | unchanged-mandate rationale | reconnaissance | no | Delivery-exclusive |
| `delivery.accept` | none | none | accept | Delivery-exclusive; short canonical publication |
| `delivery.no-ship` | reason and Candidate disposition | none | no-ship | Delivery-exclusive transaction |
| `delivery.recover` | none | none | reuses retained authority | exact unresolved effect only |

<!-- markdownlint-enable MD013 -->

`delivery.admit` chooses the `admit` Decision variant in
`awaiting-admission` and the `readmit` variant in `awaiting-readmission`.
There is no separate public readmit operation.

`delivery.no-ship` is one operation. It compiles and authenticates one exact
Director Decision before recording effect intent. There is no separate
selection record, selection operation, authorization operation, Candidate
disposition record, Cell workflow, or Reclamation record.

`delivery.recover` does not start a new activity, allocate a new Investment,
ask for new semantic input, request replacement Director judgment, or choose a
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

Semantic operation input is bounded UTF-8 Markdown under the selected interface
profile. A manual Agent operation finalizes that exact input as one fresh
`director-brief` before starting the Activity. A delegated Continue or Evaluate
instead binds the original exact standing Brief selected by the Work Delegation;
it MUST NOT manufacture a fresh Director submission from Runtime context or
previous Agent output. The Brief payload identifies its Activity or delegation
scope, operation and selected input profile. Director-authored Markdown owns the
direction or rationale in both cases.

Every `delivery.continue`, `delivery.evaluate`, `delivery.revise`, and
`delivery.reaffirm` request MUST also carry the exact runtime-issued
`expectedGeneration` against which that complete fresh Markdown was authored,
as defined by
[`productive-semantic-operation.schema.json`](../schemas/productive-semantic-operation.schema.json).
The field is a required compare-and-refuse staleness precondition, not semantic
meaning, caller-authored Process state, or a permission to rebase input. The
runtime compares it before dispatch and revalidates the complete Store,
reducer, repository, Candidate, Boundary, eligibility, and operation inputs
under the mutation lock. Missing or stale generation refuses without retaining
a Brief, starting an Activity, allocating an Investment or Cell, or consuming
the input. A client may preserve refused Markdown for explicit review but MUST
NOT silently attach it to a later generation.

Semantic input MUST NOT contain authority secret bytes, an expected Process
state, record identities, repository or Candidate digests, Investment
mechanics, provider executable or model configuration, effect-package identity,
transaction handle, time, or physical path. `expectedGeneration` is the sole
runtime-issued concurrency precondition in these productive request inputs and
is structurally distinct from the Markdown.

Preparation input is one self-contained Frame Brief. Continue and evaluate
input is a fresh direction Brief. Revise and reaffirm input is a fresh exact
resolution-rationale Brief. No-ship input belongs directly to the authenticated
Director Decision and contains one exact reason and one explicit supported
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

The nine additional `delivery.inspect` selectors expose bounded historical
Knowledge, Code, Atlas, Source, and Authorization Review facts without adding a
workflow or mutation. Authorization Review is available only for an eligible
`delivery.admit`, `delivery.accept`, or `delivery.no-ship` subject at the exact
requested generation. A presentation may request the invocation-private
challenge defined by [Authority](AUTHORITY.md#invocation-private-challenge-handoff)
only for that unchanged review. Challenge issuance, observation, or consumption
never enters `eligibleOperations` and is not a second Delivery operation.

Frame is presentation for one fresh `delivery.prepare`; every submission starts
a different Delivery and carries one complete self-contained Brief. Next Pass
is presentation over the intersection of the current reducer result and
`delivery.continue`, `delivery.integrate`, `delivery.evaluate`,
`delivery.revise`, and `delivery.reaffirm`. It is not an operation, Process
state, retained plan, provider session, or authority route. Each manual Agent
pass supplies one complete fresh semantic input and receives a newly allocated
Investment and Attempt. Delegated passes retain their original standing Brief
and reserve each fresh allocation through the Runtime owner. Integration instead uses its exact generation-only
request; it creates no Agent Attempt or Investment. No prior text area,
transcript, draft, or recommendation is inherited.

An interface may invoke only `delivery.prepare` and one currently eligible Next
Pass operation through the canonical CLI. It preserves semantic input on a
refusal or incoherent result and clears it only after the complete successor
read generation is established. `delivery.admit`, `delivery.accept`, and
`delivery.no-ship` remain explicit authority handoffs: a client may print their
direct canonical CLI form or the one generic `lifecycle authorize CHALLENGE`
form after an exact Authorization Review. `delivery.recover` remains an exact
CLI handoff. Presentation never receives authority material, authenticates a
subject, or chooses how to continue a retained effect.

No public operation allocates, dispatches, observes, cancels, retrieves,
retires, or reclaims a Cell. The CLI and TUI present the Delivery journey. A
container, backend job, Handle, materialization, or Reclamation obligation is
never a user-selected workflow subject.

## Operation Semantics

### Prepare

Preparation creates the fresh Delivery and store, finalizes the Director Brief,
and performs one read-only reconnaissance activity. The runtime:

1. observes and validates the exact target, repository contract, Knowledge Set,
   Discipline Registry, Description coverage, source availability, Check
   registry, and the direct
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
7. establishes each selected baseline Receipt, running executable baseline
   Checks in fresh Cells and recording authorized baseline postconditions as
   `not-run` without Cell allocation; and
8. completes successfully only when the complete baseline set establishes
   proposal readiness under each selected modality.

A successful completion selects the Boundary for admission. An unsuccessful
completion retains every truthful Attempt, optional Work Product, Receipt,
Boundary, and Check Receipt but selects no proposal. The Director can inspect
that dossier and close the Delivery through no-ship. Retry is a different
fresh Delivery and Investment.

### Admit and readmit

Admission is eligible for the exact proposal-ready Work Boundary after every
Activity in that Delivery is terminal. The authenticated Decision selects its
complete baseline Receipt set and exact historical repository/Atlas Snapshot.
Initial admission validates the exact retained Snapshot and target identity;
later HEAD movement, checkout dirt, or another active Delivery is not a conflict. Readmission additionally binds the
exact active predecessor, frozen Condition, and continuing Candidate. Its
Snapshot is the historical governing basis or the exact P selected by the
runtime context-change or reviewer applicability resolution route. Later canonical movement does not replace
or invalidate that retained readmission subject; acceptance independently
requires fresh integration-parent currentness.

The admission transaction:

1. revalidates the Decision, Boundary, baseline Receipts, Process head,
   historical Boundary Snapshot, Knowledge Set, authority, target identity,
   and Delivery lock; canonical HEAD need not still name that Snapshot;
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

Evaluation is eligible only for one current reconstructible Candidate with
explicit integration provenance under one active coherent Boundary. It is one Candidate-exclusive activity. The runtime:

1. reopens and validates the exact current Carrier, proves no active writer can
   mutate it, and finalizes one exact Candidate Seal;
2. validates changed paths, artifacts, Knowledge, Description coverage, and
   the sealed Product State against its exact application parent while
   preserving the active Boundary's separate governing snapshot;
3. executes every final Check in one fresh Cell against the exact Seal;
4. compiles a fresh read-only reviewer Projection with exact governing,
   integration-parent, and result subjects and baseline applicability inputs;
5. operates one independently funded reviewer Attempt in one fresh read-only
   Cell;
6. contains and retires that execution and finalizes its Work Product and
   Execution Receipt when valid; and
7. obtains the Evidence verifier's interpretation of the exact Seal, Check
   Receipts, reviewer Work Product, reviewer Receipt, and observations, then
   compiles, verifies, and retains one Evidence Packet with complete ledgers.

The Evidence Packet owns one readiness value:

- `acceptance-ready`;
- `correctable`;
- `revision-required`; or
- `no-ship-recommended`.

The `evidence-packet-finalized` event does not repeat that value. The reducer
loads it from the exact referenced Packet revision. Acceptance-ready permits
Director acceptance but does not perform it. Correctable returns the same
Candidate to work. Revision-required requires one exact frozen Material
Condition compiled from the material reviewer semantics and exact retained
evaluation joins. No-ship-recommended remains advisory; only the Director can
select no-ship.

A reviewer receives no Candidate write capability. Any mutation of the sealed
subject invalidates the evaluation coordinate. A failed evaluation preserves
the Candidate and unaffected exact-subject Evidence.

### Revise, reaffirm, and readmit

Revise and reaffirm are eligible only while one exact Material Condition
freezes the active Boundary and current Candidate. Each starts fresh
reconnaissance with exact Director rationale and retained context. A runtime
integration-context-change Condition selects the complete retained P Snapshot
named by its Assessment. An Agent-proposal Condition also selects P when its
exact reviewer Work Product judges mandate applicability `requires-readmission`
or a required baseline `insufficient`. This route requires the retained
Condition, reviewer Work Product, reviewer Attempt, Execution Receipt, Seal,
Boundary, and frozen Candidate to join exactly within the same evaluation
Activity; the Candidate's integration ancestry selects P. It does not infer a
new basis from arbitrary agent prose. Other Agent-proposal Conditions use the
governing Snapshot. Neither route samples a newer live canonical epoch.

The resolution Attempt remains read-only under the exact admitted W(B)
Capability Profile. A proposed W'(P) independently selects P's registered fixed
default Capability Profile, even if P changed or removed W's profile. The
Attempt grant and proposed successor grant are different subjects; only
Director readmission authenticates the successor mandate and its capability.

Revision produces the next Boundary revision with a changed complete mandate
field. Reaffirmation preserves complete mandate semantics and records why they
remain the Director choice. Both bind the predecessor, Condition, and frozen
Candidate, preserving its identity, bytes, and application base. A context-change
resolution can bind a new governing Snapshot within this same Delivery; only
authenticated readmission activates it.

An incomplete resolution activity leaves the Material Condition current and
selects no next revision. A complete resolution requires a fresh complete
modality-valid baseline set and moves standing to `awaiting-readmission`.
Productive work remains blocked until `delivery.admit` authenticates and
applies the `readmit` Decision.

### Accept

Acceptance is eligible only for the exact current Boundary, integrated
Candidate Revision, Seal, and acceptance-ready Evidence Packet. The Director
Decision selects these revisions and the Candidate's exact integration parent
P and result I. W may retain an older governing Snapshot B. The Decision
MUST NOT replace W, treat B as P, or authorize another parent or result.

The recoverable transaction MUST:

1. verify exact retained Evidence and the authenticated Decision;
2. retain one immutable plan and durable intent for K(tree I, parent P);
3. reopen the exact Carrier and parent, independently observe the physical
   subject, and require the Evidence verifier's acceptance interpretation;
4. prove all scope and protected-root rules over P→I;
5. under the short canonical publication lock, prove the clean target still
   names P and conditionally publish K by atomic compare-and-swap;
6. truthfully observe applied, not-applied, or indeterminate outcome;
7. establish required Containment, Runtime Retirement, and Reclamation handoff;
8. record Candidate treatment `integrated` and final Closure.

Acceptance performs no merge or context selection. Its tree is exactly I,
including P's protected Atlas and Discipline bytes. Closure binds P, K, I,
Product State, Knowledge Set, and canonical result digest. The original B and
integration origin remain available through immutable Candidate lineage.

Parent movement before application conclusively finishes that effect as
`not-applied`. It does not authorize retry against another parent. The Delivery
can perform fresh integration, applicability review, evaluation, and a new
Director acceptance without restoring P. Indeterminate application permits only
recovery of the retained plan. After applied publication, recovery can recognize
K as an ancestor of a later forward canonical result after checking K's exact
parent, tree, and transaction identity. A force rewrite or unavailable history
MUST NOT be interpreted as proof of non-application.

Delivery Control, Evidence, Decisions, transaction facts, and Closure remain
off HEAD. Acceptance MUST NOT promote Control into canonical product state.

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
- while Evidence is ready for a Director decision.

Before initial admission, the Director Decision selects the exact proposed Work
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
Foundation rc.17 supports exactly the following twenty-five kinds. All standard
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
| `director-brief-submitted` | `director-brief` | either `activityId`, or `delegationId`, `delegationRevision`, `operation` | finalizes exact fresh Activity input or standing direction with its selecting delegation |
| `work-delegation-set` | `work-delegation` | none | selects exact finite resource permission under the current admitted mandate |
| `work-delegation-stopped` | exact current `work-delegation` | `requestDigest`, `requestedAt`, `requestedBy` | folds the retained stop request after the existing Activity settles |
| `activity-started` | none | `activityId`, `operation`, and optional `reservation` | starts one eligible funded Activity and charges its exact reservation when delegated |
| `activity-recovery-recorded` | none | `activityId`, `kind`, `resumesAt`, `exactEffectDigest` | records resumption of its exact obligation |
| `agent-pre-intent-refused` | none | `activityId`, `diagnosticCode`, `refusalFactsDigest`, `resolution` | proves the Agent activity stopped before Attempt finalization or provider intent |
| `agent-attempt-prepared` | `agent-attempt` | `activityId` | finalizes the frozen invocation contract |
| `provider-effect-intended` | exact activity `agent-attempt` | `activityId`, `effectDigest` | makes dispatch intent durable |
| `provider-effect-observed` | exact activity `agent-attempt` | `activityId`, `effectDigest`, `outcome` | records `completed`, `failed`, or `not-started` |
| `agent-work-product-submitted` | `agent-work-product` | `activityId` | finalizes valid submitted Agent semantics |
| `agent-work-product-abandoned` | exact activity `agent-attempt` | `activityId` | closes the workspace with no Work Product |
| `integration-assessed` | `integration-assessment` | `activityId` | retains exact integration outcome and contextual comparison |
| `candidate-revision-observed` | `candidate-revision` | `activityId` | selects the exact observed Candidate revision |
| `execution-receipt-recorded` | `execution-receipt` | `activityId` | finalizes terminal invocation facts |
| `work-boundary-finalized` | `work-boundary` | `activityId` | finalizes one complete mandate revision |
| `material-condition-frozen` | `material-condition` | `activityId` | freezes one exact mandate-blocking condition |
| `candidate-sealed` | `candidate-seal` | `activityId` | selects the exact evaluation subject |
| `check-receipt-recorded` | `check-receipt` | `activityId` | finalizes one baseline or final Check fact |
| `evidence-packet-finalized` | `evidence-packet` | `activityId` | finalizes exact evaluation aggregation |
| `director-decision-authenticated` | `director-decision` | `activityId` | finalizes exact Director authority semantics |
| `transaction-effect-intended` | exact activity `director-decision` | `activityId`, `effectDigest` | makes the transaction plan durable before effect |
| `transaction-effect-observed` | exact activity `director-decision` | `activityId`, `effectDigest`, `facts`, `factsDigest`, `outcome` | retains typed direct observation facts and records `applied`, `not-applied`, or `indeterminate` |
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
has no record subject because no Attempt exists. Its explicit `resolution` is
`none` or `projection-condition-required`; a diagnostic string alone MUST NOT
classify a required response. The `none` outcome advances to
`activity-completed(abandoned)` after any prearmed operation and private
execution support have been retired. Proven absence of allocation requires no
invented Handle, Attempt, Receipt, or Reclamation handoff.

The `projection-condition-required` outcome is legal for `continue` before
builder allocation and for evaluation after all prior Check effects have been
conclusively contained and retired and before reviewer allocation. The context
owner MUST establish the exact measured mandatory-closure impossibility defined
by [Control](CONTROL.md#material-condition). A pre-opening builder refusal retains
its exact Brief, Activity opening, refusal, Condition and abandoned completion
atomically; it creates no execution support or allocation. Evaluation retains
refusal and its Condition in one guarded retention plan after the completed
Checks. Completion MUST NOT skip the Condition.

An interrupted retained prefix permits only exact finalization recovery; after
completion, revise, reaffirm, and no-ship are available under the ordinary
paused-Boundary rules. Resolution uses an independent bounded Orientation with
the exact mandate and measured refusal. It does not recompile the impossible
builder or reviewer closure. It proposes a complete mandate and permitted
context selection; it cannot waive bounds or reactivate work before
authenticated readmission.

Unavailability, a generic compilation exception, or an untrusted object with
the same diagnostic code MUST NOT establish this outcome. If execution or
custody remains unresolved, recovery keeps that exact obligation.
`transaction-effect-intended` and `transaction-effect-observed` resolve the
exact Director Decision already selected by the activity. The `effectDigest`
identifies the complete recoverable effect plan; it is not a Decision digest,
transaction handle, physical path, or authority secret.

One transaction intent has one matching terminal observation. Recovery MUST NOT
append a replacement intent or select a successor effect. Exact event order and
physical facts prove whether the retained effect applied. Conclusive non-
application finishes that transaction; a later eligible integration and new
Decision create a distinct effect rather than rewriting the old one.

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
scope, and idempotence rule. Foundation rc.17 supports only these steps:

<!-- markdownlint-disable MD013 -->

| Kind | `resumesAt` | Exact next boundary |
| --- | --- | --- |
| `finalization` | `candidate-sealed` | observe, compile, and retain the exact Candidate Seal selected by the evaluation activity |
| `finalization` | `agent-attempt-prepared` | atomically retain the exact Agent Attempt and provider intent, or retain a pre-intent refusal with no Attempt |
| `finalization` | `provider-effect-intended` | compile and retain dispatch intent for the exact prepared Agent Attempt |
| `provider` | `provider-effect-observed` | observe, contain, and retrieve the same dispatched Attempt Cell without redispatch |
| `finalization` | `work-product-observation` | independently validate retrieved semantic output and submit or abandon the exact governed workspace |
| `finalization` | `integration-assessed` | resume exact retained B/C/P assessment and its guarded finalization |
| `candidate-observation` | `candidate-revision-observed` | publish and select the exact initial, valid builder or integration successor, or readmission-rebind Candidate Revision |
| `finalization` | `execution-receipt-recorded` | retire the exact execution, hand off any Reclamation obligation, and retain the terminal Execution Receipt |
| `finalization` | `work-boundary-finalized` | compile the exact next Work Boundary revision, or retain unsuccessful activity completion when the frozen semantics and exact basis deterministically refuse compilation |
| `finalization` | `baseline-checks` | retain the next exact baseline Receipt, executing, containing, and retiring a Cell when the modality requires execution, or recording an authorized postcondition `not-run`; complete after the exact set |
| `finalization` | `evaluation-checks` | execute, contain, retire, and retain the next final Check Receipt, atomically open reviewer Attempt plus intent, or retain a pre-intent refusal |
| `finalization` | `activity-finalization` | retain the next semantics-determined Condition, Evidence, Check, or completion fact |
| `finalization` | `activity-completed` | complete the exact nonterminal activity |
| `finalization` | `director-decision-authenticated` | authenticate and retain the exact Decision selected by the started transaction activity |
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
  -> director-brief-submitted
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
director-brief-submitted
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

Integration follows:

```text
activity-started(delivery.integrate)
  -> integration-assessed
  -> [candidate-revision-observed(integration-successor)]
  -> [material-condition-frozen(integration-assessment)]
  -> activity-completed
```

A complete conflicted or invalid assessment completes the Activity without a
successor. A constructed assessment selects its exact successor before completion
and retains the required context-change freeze before productive eligibility.
A partially finalized integration remains recoverable at its exact retained
coordinate. No provider effect, Work Product, or Execution Receipt is fabricated.

Evaluation follows:

```text
director-brief-submitted
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
Their fresh `director-brief-submitted` event binds the exact Director rationale
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
  -> director-decision-authenticated
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
completes only the same exact retained effect under its Director Decision,
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

Each activity has exact identity, operation, family `agent`, `integration`, or `transaction`,
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
- `accepted` — Closure records canonical publication of the exact sealed revision; or
- `abandoned` — Closure records no-ship treatment of an existing Candidate
  without canonical publication.

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
| active, Candidate reconstructible, no unresolved activity | `delivery.continue`, `delivery.integrate`, `delivery.evaluate` when integrated, `delivery.no-ship` |
| boundary-paused | `delivery.revise`, `delivery.reaffirm`, `delivery.no-ship` |
| awaiting-readmission | `delivery.admit`, `delivery.no-ship` |
| decision-ready | `delivery.accept` when the exact integration parent is current, `delivery.integrate`, `delivery.no-ship` |
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
It invalidates only proof whose exact subject changed. A failed provider
invocation does not answer whether its output is useful: valid retained
Candidate advancement remains available to correction even when the Attempt
was unsuccessful. Conversely, invalid output does not replace the prior current
Candidate; exact retained repair output can inform a later builder without
becoming governing Product Knowledge.

Integration conflict is another correction input. The builder receives the
exact attempted parent and conflict facts, works from the retained Candidate,
and integrates again. A successful integration is then evaluated against its
exact Seal and application parent. The existence of a permitted next operation
alone does not establish that these connected steps have completed.

Finding that selected Discipline guidance is inapplicable, unhelpful, or in
tension with repository reality does not by itself create a Material Condition
or acceptance failure. The agent uses judgment, can explain the mismatch, and
continues under the authoritative mandate. A real change to meaning, risk,
architecture, Assurance, or another owned mandate fact follows the normal
Material Condition route regardless of whether Discipline helped reveal it.

A Material Condition instead requires an explicit response to the governing
choice or an unmet prerequisite. For example, conclusive mandatory-context
overflow freezes the exact Boundary and Candidate without dispatching an Agent
with incomplete context. Resolution uses that frozen subject; an explicitly
permitted larger profile can survive proposal finalization and readmission,
after which productive continuation or evaluation can run. The Condition is
not cleared by retrying the same inadequate default.

Standard classes include:

- meaning ambiguity or mandate falsifier;
- scope, effect, or risk change;
- architecture or Assurance conflict;
- missing authority or required source;
- required capability unavailable;
- Projection closure exceeded; and
- no honest route.

Canonical movement alone is not a Material Condition and does not block
historical continuation. An exact integration assessment that finds changed
governing context creates the runtime-owned `integration-context-change`
variant, freezing its constructed successor for resolution and readmission.

The runtime finalizes one `material-condition` revision only from exact retained
source facts and the active reducer coordinate. An Agent proposal remains
agent-proposed semantics; the runtime-owned Condition establishes the Process
freeze. While it is current, productive continuation is ineligible. Revision,
reaffirmation plus readmission, or no-ship resolves it.

## Transactions and Exact Recovery

An authority-bearing operation separates three subjects:

1. the Director Decision owns authenticated judgment;
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
over the exact integration parent. No-ship leaves canonical product bytes
unchanged while establishing an authenticated terminal Process disposition.

## Closure, Seal, and Archive

Closure is one sufficient immutable terminal Control revision. Its exact typed
payload and relationships establish:

- `accepted` or `no-ship` disposition;
- authenticated Director Decision and applied transaction facts;
- selected Work Boundary when one exists;
- exact accepted or abandoned Candidate Revision when one exists;
- Candidate Seal and Evidence Packet for acceptance;
- Candidate treatment: `integrated` for acceptance, `abandoned` for
  no-ship after Candidate creation, or `not-created` for no-ship before it;
- for acceptance, the integration parent and exact accepted canonical result
  identity, or verified non-publication for no-ship;
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

Each Delivery MUST use an independent private Git repository and its own branch,
with separate administration, refs, index, configuration, and working state.
This is the sole supported topology. A linked target worktree, borrowed mutable
Git administration, or selectable workspace strategy is unsupported. Private
repositories remain reconstructible support; Control and Carrier identity own
continuity. A Delivery repository is not a separately initialized target.

Distinct Deliveries may prepare, continue, integrate, and evaluate concurrently.
Their per-Delivery lock serializes each Store's operation and Candidate writer.
Sealing, integration, successor publication, and proof remain Candidate-
exclusive. A busy refusal creates no requested Activity. Read-only operations
present one coherent Store coordinate without reserving canonical state.

Canonical observation and publication use a short target lock. The canonical
compare-and-swap remains necessary: no long-lived Delivery lease excludes
another Delivery or manual branch movement. Expensive reconstruction and review
use retained inputs outside that short lock. Admission authenticates the exact retained initial
Snapshot; readmission activates an exact retained successor mandate; acceptance
publishes only its signed integration parent/result pair. Recovery acquires the
scope required by the retained obligation, never another Delivery's authority.

Two overlapping Deliveries can both remain active. If one publishes after the
other selected its integration parent, the latter finishes a conclusive stale
acceptance as not applied and constructs a fresh integration. Canonical Atlas
or Discipline maintenance follows the same rule. No operation rewrites an
existing Assessment, Evidence Packet, Director Decision, or transaction plan.

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
- invalid Director authentication or effect-plan substitution;
- direct SQL modification, missing exact support, or ambiguous recovery;
- incomplete Containment or Retirement, substituted Handle or allocation,
  missing Reclamation handoff, or untracked executable capability; and
- Closure-head, store-seal, archive-manifest, or retrieval-byte mismatch.

Failure is local to its owner. Provider failure does not delete the Candidate.
Invalid Agent Markdown does not become a Work Product. A Check failure does not
rewrite its proposition. An Evidence failure does not revoke Director authority
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
  Director Decision into one carrier;
- make Agent prose authoritative for repository, Candidate, Check, or Process
  facts;
- make an Agent construct headers, fixed bindings, relationships, ordering,
  digests, events, envelopes, or transport values;
- place Delivery Control, SQLite, exports, or archives on HEAD;
- infer authority from eligibility, interface state, or agent recommendation;
  or
- provide predecessor support, migration, compatibility carriers, or a second
  Process route.
